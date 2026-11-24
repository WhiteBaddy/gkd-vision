package dev.everything.vision

import android.accessibilityservice.AccessibilityService
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

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        server?.stop()
        server = VisionServer(this).also { it.start() }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            event.packageName?.toString()?.let { lastPackage = it }
            event.className?.toString()?.let { lastClass = it }
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        server?.stop()
        server = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    fun isConnected(): Boolean = instance === this

    companion object {
        @Volatile
        var instance: A11yService? = null
            private set
    }
}
