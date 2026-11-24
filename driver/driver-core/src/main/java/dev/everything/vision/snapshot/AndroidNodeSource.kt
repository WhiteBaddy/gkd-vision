package dev.everything.vision.snapshot

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/** 将 AccessibilityNodeInfo 适配为 NodeSource。 */
class AndroidNodeSource(
    private val node: AccessibilityNodeInfo,
    override val index: Int,
) : NodeSource {
    private val bounds = Rect().also { node.getBoundsInScreen(it) }

    override val className: String? = node.className?.toString()
    override val viewId: String? = node.viewIdResourceName
    override val text: String? = node.text?.toString()
    override val desc: String? = node.contentDescription?.toString()
    override val clickable: Boolean = node.isClickable
    override val longClickable: Boolean = node.isLongClickable
    override val editable: Boolean = node.isEditable
    override val visibleToUser: Boolean = node.isVisibleToUser
    override val packageName: String? = node.packageName?.toString()
    override val left: Int = bounds.left
    override val top: Int = bounds.top
    override val right: Int = bounds.right
    override val bottom: Int = bounds.bottom
    override val childCount: Int = node.childCount

    override fun childAt(index: Int): NodeSource? =
        node.getChild(index)?.let { AndroidNodeSource(it, index) }
}
