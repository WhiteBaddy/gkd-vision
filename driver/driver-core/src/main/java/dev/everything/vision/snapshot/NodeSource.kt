package dev.everything.vision.snapshot

/**
 * 与平台无关的节点视图，便于 JVM 单测；Android 侧由 AndroidNodeSource 适配。
 */
interface NodeSource {
    val className: String?
    val viewId: String?
    val text: String?
    val desc: String?
    val clickable: Boolean
    val longClickable: Boolean
    val editable: Boolean
    val visibleToUser: Boolean
    val packageName: String?
    val left: Int
    val top: Int
    val right: Int
    val bottom: Int
    val childCount: Int
    val index: Int

    fun childAt(index: Int): NodeSource?
}
