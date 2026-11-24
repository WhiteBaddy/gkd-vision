package dev.everything.vision.snapshot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private class FakeNode(
    override val className: String? = "android.widget.FrameLayout",
    override val viewId: String? = null,
    override val text: String? = null,
    override val desc: String? = null,
    override val clickable: Boolean = false,
    override val longClickable: Boolean = false,
    override val editable: Boolean = false,
    override val visibleToUser: Boolean = true,
    override val packageName: String? = "com.demo",
    override val left: Int = 0,
    override val top: Int = 0,
    override val right: Int = 100,
    override val bottom: Int = 100,
    override val index: Int = 0,
    private val children: List<FakeNode> = emptyList(),
) : NodeSource {
    override val childCount: Int get() = children.size
    override fun childAt(index: Int): NodeSource? = children.getOrNull(index)
}

class SnapshotBuilderTest {

    @Test
    fun `flattens tree with ids pids and depth`() {
        val tree = FakeNode(
            children = listOf(
                FakeNode(text = "a", index = 0),
                FakeNode(
                    text = "b",
                    index = 1,
                    children = listOf(FakeNode(text = "b1", index = 0)),
                ),
            ),
        )

        val nodes = SnapshotBuilder().build(tree)

        assertEquals(4, nodes.size)
        assertEquals(listOf(0, 1, 2, 3), nodes.map { it.id })
        assertEquals(listOf(-1, 0, 0, 2), nodes.map { it.pid })
        assertEquals(listOf(0, 1, 1, 2), nodes.map { it.attr.depth })
        assertEquals(0, nodes[0].attr.index)
        assertEquals(0, nodes[1].attr.index)
        assertEquals(1, nodes[2].attr.index)
        assertEquals(0, nodes[3].attr.index)
    }

    @Test
    fun `derives vid only for own package`() {
        val builder = SnapshotBuilder()
        assertEquals("search", builder.vidOf("com.demo:id/search", "com.demo"))
        assertNull(builder.vidOf("com.other:id/search", "com.demo"))
        assertNull(builder.vidOf("search", "com.demo"))
        assertNull(builder.vidOf(null, "com.demo"))
    }

    @Test
    fun `caps node count`() {
        val wide = FakeNode(children = (0 until 10).map { FakeNode(text = "c$it", index = it) })
        val nodes = SnapshotBuilder(maxNodes = 3).build(wide)
        assertEquals(3, nodes.size)
    }

    @Test
    fun `caps children per node`() {
        val wide = FakeNode(children = (0 until 10).map { FakeNode(text = "c$it", index = it) })
        val nodes = SnapshotBuilder(maxChildren = 2).build(wide)
        assertEquals(3, nodes.size)
    }

    @Test
    fun `caps depth`() {
        var node = FakeNode(text = "leaf")
        repeat(5) { i -> node = FakeNode(text = "n$i", children = listOf(node)) }
        val nodes = SnapshotBuilder(maxDepth = 2).build(node)
        assertEquals(3, nodes.size)
        assertEquals(2, nodes.maxOf { it.attr.depth })
    }
}
