package dev.everything.vision

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * 无障碍服务入口。S1-T2 起在此挂载快照、截图与 HTTP 服务。
 */
class A11yService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // S1: 记录前台窗口变化，供快照使用；暂不处理。
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        var instance: A11yService? = null
            private set
    }
}
