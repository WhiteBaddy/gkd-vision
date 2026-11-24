package dev.everything.vision.snapshot

import dev.everything.vision.model.NodeAttrs
import dev.everything.vision.model.SnapshotNode

/**
 * 深度优先遍历，生成扁平节点列表（父在前，子在后），id 自增，pid 指向父 id。
 *
 * 上限对齐 GKD：单节点子数 512、总节点 4096、深度 64，避免异常树拖垮服务线程。
 */
class SnapshotBuilder(
    private val maxNodes: Int = 4096,
    private val maxDepth: Int = 64,
    private val maxChildren: Int = 512,
) {
    private val nodes = ArrayList<SnapshotNode>(256)
    private var nextId = 0

    fun build(root: NodeSource): List<SnapshotNode> {
        nodes.clear()
        nextId = 0
        visit(root, parentId = -1, depth = 0)
        return nodes.toList()
    }

    fun vidOf(viewId: String?, packageName: String?): String? {
        if (viewId == null || packageName == null) return null
        val prefix = "$packageName:id/"
        if (!viewId.startsWith(prefix)) return null
        val vid = viewId.substring(prefix.length)
        return vid.ifEmpty { null }
    }

    private fun visit(node: NodeSource, parentId: Int, depth: Int) {
        if (nodes.size >= maxNodes || depth > maxDepth) return
        val id = nextId++
        val viewId = node.viewId
        nodes.add(
            SnapshotNode(
                id = id,
                pid = parentId,
                attr = NodeAttrs(
                    name = node.className,
                    viewId = viewId,
                    vid = vidOf(viewId, node.packageName),
                    text = node.text,
                    desc = node.desc,
                    clickable = node.clickable,
                    longClickable = node.longClickable,
                    editable = node.editable,
                    visibleToUser = node.visibleToUser,
                    left = node.left,
                    top = node.top,
                    right = node.right,
                    bottom = node.bottom,
                    childCount = node.childCount,
                    index = node.index,
                    depth = depth,
                ),
            ),
        )
        val count = minOf(node.childCount, maxChildren)
        for (i in 0 until count) {
            val child = node.childAt(i) ?: continue
            visit(child, parentId = id, depth = depth + 1)
            if (nodes.size >= maxNodes) return
        }
    }
}
