package dev.everything.vision.action

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LiteSelectorTest {

    @Test
    fun `parses single property`() {
        val sel = LiteSelector.parse("[text=\"确定\"]")
        assertEquals("确定", sel.text)
        assertNull(sel.desc)
    }

    @Test
    fun `parses multiple properties as AND`() {
        val sel = LiteSelector.parse("""[vid="row_1"] [clickable=true]""")
        assertEquals("row_1", sel.vid)
        assertEquals(true, sel.clickable)
    }

    @Test
    fun `parses editable`() {
        val sel = LiteSelector.parse("[editable=true]")
        assertEquals(true, sel.editable)
    }

    @Test
    fun `parses view id`() {
        val sel = LiteSelector.parse("""[id="com.demo:id/search"]""")
        assertEquals("com.demo:id/search", sel.viewId)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects empty selector`() {
        LiteSelector.parse("   ")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects unknown property`() {
        LiteSelector.parse("[foo=1]")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects trailing garbage`() {
        LiteSelector.parse("""[text="a"] and more""")
    }

    @Test
    fun `empty check reflects properties`() {
        assertTrue(LiteSelector.parse("[clickable=false]").isEmpty.not())
    }
}
