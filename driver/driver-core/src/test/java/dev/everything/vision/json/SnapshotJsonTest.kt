package dev.everything.vision.json

import dev.everything.vision.model.AppInfo
import dev.everything.vision.model.DeviceInfo
import dev.everything.vision.model.NodeAttrs
import dev.everything.vision.model.ScreenshotStatus
import dev.everything.vision.model.Snapshot
import dev.everything.vision.model.SnapshotNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SnapshotJsonTest {

    private val device = DeviceInfo("device", "model", "maker", "brand", 35, "15")
    private val app = AppInfo("dev.everything.vision", "Vision Driver", 1, "0.1.0-alpha")

    private fun node(id: Int, pid: Int, text: String?, clickable: Boolean) = SnapshotNode(
        id = id,
        pid = pid,
        attr = NodeAttrs(
            name = "android.widget.TextView",
            viewId = "com.demo:id/row_$id",
            vid = "row_$id",
            text = text,
            desc = null,
            clickable = clickable,
            longClickable = false,
            editable = false,
            visibleToUser = true,
            left = 0,
            top = 10 * id,
            right = 100,
            bottom = 10 * id + 5,
            childCount = 0,
            index = id,
            depth = 1,
        ),
    )

    private val snapshot = Snapshot(
        id = 7,
        appId = "com.demo",
        activityId = "com.demo/.Main",
        screenWidth = 1200,
        screenHeight = 2608,
        isLandscape = false,
        appInfo = AppInfo("com.demo", "Demo", 2, "2.0"),
        gkdAppInfo = app,
        device = device,
        nodes = listOf(node(0, -1, null, false), node(1, 0, "确定", true)),
        screenshot = ScreenshotStatus(ok = true, bytes = 1234),
    )

    @Test
    fun `serializes top level fields`() {
        val json = SnapshotJson.toJson(snapshot)
        assertEquals(7, json.getInt("id"))
        assertEquals("com.demo", json.getString("appId"))
        assertEquals(1200, json.getInt("screenWidth"))
        assertFalse(json.getBoolean("isLandscape"))
        assertEquals("dev.everything.vision", json.getJSONObject("gkdAppInfo").getString("id"))
        assertTrue(json.getJSONObject("screenshot").getBoolean("ok"))
    }

    @Test
    fun `serializes nodes with null text`() {
        val json = SnapshotJson.toJson(snapshot)
        val nodes = json.getJSONArray("nodes")
        assertEquals(2, nodes.length())
        val first = nodes.getJSONObject(0).getJSONObject("attr")
        assertTrue(first.isNull("text"))
        assertEquals("row_0", first.getString("vid"))
        assertEquals(100, first.getInt("width"))
        assertEquals("确定", nodes.getJSONObject(1).getJSONObject("attr").getString("text"))
    }
}
