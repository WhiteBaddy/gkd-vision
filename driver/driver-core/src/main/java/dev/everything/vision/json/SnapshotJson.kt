package dev.everything.vision.json

import dev.everything.vision.model.AppInfo
import dev.everything.vision.model.DeviceInfo
import dev.everything.vision.model.Snapshot
import dev.everything.vision.model.SnapshotNode
import org.json.JSONArray
import org.json.JSONObject

/** 与 GKD ComplexSnapshot 字段对齐的序列化。 */
object SnapshotJson {

    fun toJson(snapshot: Snapshot): JSONObject = JSONObject().apply {
        put("id", snapshot.id)
        put("appId", snapshot.appId)
        put("activityId", snapshot.activityId ?: JSONObject.NULL)
        put("screenWidth", snapshot.screenWidth)
        put("screenHeight", snapshot.screenHeight)
        put("isLandscape", snapshot.isLandscape)
        put("appInfo", snapshot.appInfo?.let(::appJson) ?: JSONObject.NULL)
        put("gkdAppInfo", appJson(snapshot.gkdAppInfo))
        put("device", deviceJson(snapshot.device))
        put(
            "screenshot",
            JSONObject().apply {
                put("ok", snapshot.screenshot.ok)
                put("code", snapshot.screenshot.code ?: JSONObject.NULL)
                put("bytes", snapshot.screenshot.bytes)
            },
        )
        put("nodes", JSONArray().apply { snapshot.nodes.forEach { put(nodeJson(it)) } })
    }

    fun nodeJson(node: SnapshotNode): JSONObject = JSONObject().apply {
        put("id", node.id)
        put("pid", node.pid)
        put(
            "attr",
            JSONObject().apply {
                put("name", node.attr.name ?: JSONObject.NULL)
                put("id", node.attr.viewId ?: JSONObject.NULL)
                put("vid", node.attr.vid ?: JSONObject.NULL)
                put("text", node.attr.text ?: JSONObject.NULL)
                put("desc", node.attr.desc ?: JSONObject.NULL)
                put("clickable", node.attr.clickable)
                put("longClickable", node.attr.longClickable)
                put("editable", node.attr.editable)
                put("visibleToUser", node.attr.visibleToUser)
                put("left", node.attr.left)
                put("top", node.attr.top)
                put("right", node.attr.right)
                put("bottom", node.attr.bottom)
                put("width", node.attr.width)
                put("height", node.attr.height)
                put("childCount", node.attr.childCount)
                put("index", node.attr.index)
                put("depth", node.attr.depth)
            },
        )
    }

    fun deviceJson(device: DeviceInfo): JSONObject = JSONObject().apply {
        put("device", device.device)
        put("model", device.model)
        put("manufacturer", device.manufacturer)
        put("brand", device.brand)
        put("sdkInt", device.sdkInt)
        put("release", device.release)
    }

    fun appJson(app: AppInfo): JSONObject = JSONObject().apply {
        put("id", app.id)
        put("name", app.name)
        put("versionCode", app.versionCode)
        put("versionName", app.versionName)
    }
}
