package dev.everything.vision

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityWindowInfo
import android.view.accessibility.AccessibilityEvent
import dev.everything.vision.server.VisionServer

/**
 * 无障碍服务入口：维护前台信息，并在连接后启动本地 HTTP 服务。
 */
class A11yService : AccessibilityService() {

    @Volatile
    var lastPackage: String? = null
        private set

    @Volatile
    var lastClass: String? = null
        private set

    private var server: VisionServer? = null
    private val watchdog = Handler(Looper.getMainLooper())
    private val watchdogTick = object : Runnable {
        override fun run() {
            if (server?.isRunning != true) {
                Log.w("VisionDriver", "http server down, restarting")
                server?.stop()
                server = VisionServer(this@A11yService).also { it.start() }
            }
            watchdog.postDelayed(this, 30_000)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        server?.stop()
        server = VisionServer(this).also { it.start() }
        watchdog.removeCallbacks(watchdogTick)
        watchdog.postDelayed(watchdogTick, 30_000)
        Log.i("VisionDriver", "service connected, http server starting on 127.0.0.1:8899")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            event.packageName?.toString()?.let { lastPackage = it }
            event.className?.toString()?.let { lastClass = it }
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        watchdog.removeCallbacks(watchdogTick)
        server?.stop()
        server = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun isConnected(): Boolean = instance === this

    fun isImeVisible(): Boolean =
        windows?.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD } == true

    /** 多窗口/分屏时优先取活跃窗口的根节点。 */
    fun activeRoot(): android.view.accessibility.AccessibilityNodeInfo? {
        val active = windows?.firstOrNull { it.isActive }?.root
        return active ?: rootInActiveWindow
    }

    companion object {
        @Volatile
        var instance: A11yService? = null
            private set
    }
}
