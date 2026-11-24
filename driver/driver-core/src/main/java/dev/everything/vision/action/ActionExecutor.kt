package dev.everything.vision.action

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.ViewConfiguration
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt
import org.json.JSONObject

/** 把 GKD 形状的 execSelector 负载映射为无障碍动作。 */
class ActionExecutor(private val service: dev.everything.vision.A11yService) {

    fun exec(payload: JSONObject): JSONObject {
        val selectorSource = payload.optString("selector", "")
        val action = payload.optString("action", "")
        val selector = if (selectorSource.isBlank()) null else LiteSelector.parse(selectorSource)
        val root = service.activeRoot() ?: throw IllegalStateException("无法读取当前窗口")
        val node = selector?.let { NodeMatcher.findFirst(root, it) }

        if (action.isEmpty() || action == "none") {
            return JSONObject().apply {
                put("action", "none")
                put("result", node != null || selector == null)
                put("matched", node != null)
                put("text", node?.text?.toString() ?: JSONObject.NULL)
                put("vid", node?.viewIdResourceName ?: JSONObject.NULL)
            }
        }

        return when (action) {
            "click", "clickNode" -> click(node, payload)
            "clickCenter" -> clickCenter(node, payload)
            "longClick", "longClickNode" -> longClick(node, payload)
            "longClickCenter" -> longClickCenter(node, payload)
            "swipe" -> swipe(node, payload)
            "back" -> back()
            else -> throw IllegalArgumentException("不支持的动作: $action")
        }
    }

    fun setText(payload: JSONObject): JSONObject {
        val selectorSource = payload.optString("selector", "")
        val selector = if (selectorSource.isBlank()) null else LiteSelector.parse(selectorSource)
        val root = service.activeRoot() ?: throw IllegalStateException("无法读取当前窗口")
        val node = if (selector != null) {
            NodeMatcher.findFirst(root, selector) ?: throw IllegalStateException("未找到匹配节点")
        } else {
            root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                ?: throw IllegalStateException("当前没有聚焦的输入框")
        }
        if (!node.isEditable) throw IllegalStateException("节点不可编辑")
        val text = payload.optString("text", "")
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        var ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        var applied = verifyText(node, text)
        // WebView 等场景 ACTION_SET_TEXT 常返回 true 但不生效，退化为剪贴板粘贴。
        if (!applied && text.isNotEmpty()) {
            ok = pasteInto(node, text) || ok
            applied = verifyText(node, text)
        }
        return JSONObject().apply {
            put("action", "setText")
            put("result", ok)
            put("applied", applied)
            put("length", text.length)
        }
    }

    private fun verifyText(node: AccessibilityNodeInfo, expected: String): Boolean {
        repeat(3) {
            node.refresh()
            if (node.text?.toString() == expected) return true
            Thread.sleep(120)
        }
        return false
    }

    private fun pasteInto(node: AccessibilityNodeInfo, text: String): Boolean {
        val clipboard = service.getSystemService(ClipboardManager::class.java) ?: return false
        clipboard.setPrimaryClip(ClipData.newPlainText("vision", text))
        val rect = Rect().also { node.getBoundsInScreen(it) }
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        tap(rect.centerX(), rect.centerY(), ViewConfiguration.getTapTimeout().toLong())
        Thread.sleep(150)
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    }

    private fun click(node: AccessibilityNodeInfo?, payload: JSONObject): JSONObject {
        val target = node ?: throw IllegalStateException("该动作需要匹配节点")
        if (target.isClickable && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            return result("click", true)
        }
        return clickCenter(target, payload)
    }

    private fun clickCenter(node: AccessibilityNodeInfo?, payload: JSONObject): JSONObject {
        val point = pointOf(node, payload, "position") ?: throw IllegalArgumentException("缺少 position 或节点")
        val duration = ViewConfiguration.getTapTimeout().toLong()
        val ok = tap(point.first, point.second, duration)
        return result("clickCenter", ok, point)
    }

    private fun longClick(node: AccessibilityNodeInfo?, payload: JSONObject): JSONObject {
        val target = node ?: throw IllegalStateException("该动作需要匹配节点")
        if (target.isLongClickable && target.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)) {
            return result("longClick", true)
        }
        return longClickCenter(target, payload)
    }

    private fun longClickCenter(node: AccessibilityNodeInfo?, payload: JSONObject): JSONObject {
        val point = pointOf(node, payload, "position") ?: throw IllegalArgumentException("缺少 position 或节点")
        val duration = payload.optLong("duration", 600L).coerceIn(200L, 3000L)
        val ok = tap(point.first, point.second, duration)
        return result("longClickCenter", ok, point)
    }

    private fun swipe(node: AccessibilityNodeInfo?, payload: JSONObject): JSONObject {
        val arg = payload.optJSONObject("swipeArg") ?: throw IllegalArgumentException("缺少 swipeArg")
        val startObj = arg.optJSONObject("start") ?: throw IllegalArgumentException("缺少 swipeArg.start")
        val endObj = arg.optJSONObject("end") ?: startObj
        val start = pointFromObject(node, startObj) ?: throw IllegalArgumentException("swipeArg.start 非法")
        val end = pointFromObject(node, endObj) ?: throw IllegalArgumentException("swipeArg.end 非法")
        val duration = arg.optLong("duration", 300L).coerceIn(50L, 5000L)
        val path = Path().apply {
            moveTo(start.first.toFloat(), start.second.toFloat())
            lineTo(end.first.toFloat(), end.second.toFloat())
        }
        val ok = gesture(path, duration)
        return JSONObject().apply {
            put("action", "swipe")
            put("result", ok)
            put("position", arr(end.first, end.second))
        }
    }

    private fun back(): JSONObject = JSONObject().apply {
        put("action", "back")
        put("result", service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK))
    }

    private fun result(action: String, ok: Boolean, point: Pair<Int, Int>? = null): JSONObject = JSONObject().apply {
        put("action", action)
        put("result", ok)
        point?.let { put("position", arr(it.first, it.second)) }
    }

    private fun arr(x: Int, y: Int) = org.json.JSONArray().apply {
        put(x)
        put(y)
    }

    private fun pointOf(node: AccessibilityNodeInfo?, payload: JSONObject, key: String): Pair<Int, Int>? {
        payload.optJSONObject(key)?.let { return pointFromObject(node, it) }
        if (node != null) {
            val rect = Rect().also { node.getBoundsInScreen(it) }
            return rect.centerX() to rect.centerY()
        }
        return null
    }

    /** 支持 GKD 的绝对坐标 x/y，以及相对节点左上的 left/top。 */
    private fun pointFromObject(node: AccessibilityNodeInfo?, obj: JSONObject): Pair<Int, Int>? {
        val x = number(obj, "x")
        val y = number(obj, "y")
        val rect = node?.let { n -> Rect().also { r -> n.getBoundsInScreen(r) } }
        val px = when {
            x != null -> x
            rect != null && number(obj, "left") != null -> rect.left + number(obj, "left")!!
            else -> null
        } ?: return null
        val py = when {
            y != null -> y
            rect != null && number(obj, "top") != null -> rect.top + number(obj, "top")!!
            else -> null
        } ?: return null
        return px.roundToInt() to py.roundToInt()
    }

    private fun number(obj: JSONObject, key: String): Float? {
        if (!obj.has(key)) return null
        val raw = obj.opt(key) ?: return null
        return when (raw) {
            is Number -> raw.toFloat()
            is String -> raw.trim().toFloatOrNull()
            else -> null
        }
    }

    private fun tap(x: Int, y: Int, durationMs: Long): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        return gesture(path, durationMs)
    }

    private fun gesture(path: Path, durationMs: Long): Boolean {
        val description = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        val latch = CountDownLatch(1)
        val ok = AtomicBoolean(false)
        val dispatched = service.dispatchGesture(
            description,
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    ok.set(true)
                    latch.countDown()
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    latch.countDown()
                }
            },
            Handler(Looper.getMainLooper()),
        )
        if (!dispatched) return false
        latch.await(5, TimeUnit.SECONDS)
        return ok.get()
    }
}
