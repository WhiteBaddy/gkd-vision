package dev.everything.vision.action

import android.view.accessibility.AccessibilityNodeInfo

/** 在实时树上按 [LiteSelector] 查找节点（深度优先，取第一个匹配）。 */
object NodeMatcher {

    fun findFirst(root: AccessibilityNodeInfo, selector: LiteSelector, maxDepth: Int = 64): AccessibilityNodeInfo? =
        walk(root, selector, 0, maxDepth)

    fun findAll(root: AccessibilityNodeInfo, selector: LiteSelector, limit: Int = 64): List<AccessibilityNodeInfo> {
        val result = ArrayList<AccessibilityNodeInfo>(8)
        collect(root, selector, 0, 64, limit, result)
        return result
    }

    private fun walk(node: AccessibilityNodeInfo, selector: LiteSelector, depth: Int, maxDepth: Int): AccessibilityNodeInfo? {
        if (depth > maxDepth) return null
        if (matches(node, selector)) return node
        for (i in 0 until minOf(node.childCount, 512)) {
            val child = node.getChild(i) ?: continue
            walk(child, selector, depth + 1, maxDepth)?.let { return it }
        }
        return null
    }

    private fun collect(
        node: AccessibilityNodeInfo,
        selector: LiteSelector,
        depth: Int,
        maxDepth: Int,
        limit: Int,
        out: MutableList<AccessibilityNodeInfo>,
    ) {
        if (depth > maxDepth || out.size >= limit) return
        if (matches(node, selector)) out.add(node)
        for (i in 0 until minOf(node.childCount, 512)) {
            val child = node.getChild(i) ?: continue
            collect(child, selector, depth + 1, maxDepth, limit, out)
        }
    }

    fun matches(node: AccessibilityNodeInfo, selector: LiteSelector): Boolean {
        selector.text?.let { if (node.text?.toString() != it) return false }
        selector.desc?.let { if (node.contentDescription?.toString() != it) return false }
        selector.viewId?.let { if (node.viewIdResourceName != it) return false }
        selector.vid?.let {
            val pkg = node.packageName?.toString()
            val id = node.viewIdResourceName
            if (id == null || pkg == null || !id.startsWith("$pkg:id/") || id.substringAfter(":id/") != it) return false
        }
        selector.clickable?.let { if (node.isClickable != it) return false }
        selector.editable?.let { if (node.isEditable != it) return false }
        return true
    }
}
