package dev.everything.vision.model

data class DeviceInfo(
    val device: String,
    val model: String,
    val manufacturer: String,
    val brand: String,
    val sdkInt: Int,
    val release: String,
)

data class AppInfo(
    val id: String,
    val name: String,
    val versionCode: Int,
    val versionName: String,
)

data class NodeAttrs(
    val name: String?,
    val viewId: String?,
    val vid: String?,
    val text: String?,
    val desc: String?,
    val clickable: Boolean,
    val longClickable: Boolean,
    val editable: Boolean,
    val visibleToUser: Boolean,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
    val childCount: Int,
    val index: Int,
    val depth: Int,
) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
}

data class SnapshotNode(
    val id: Int,
    val pid: Int,
    val attr: NodeAttrs,
)

data class Snapshot(
    val id: Int,
    val appId: String,
    val activityId: String?,
    val screenWidth: Int,
    val screenHeight: Int,
    val isLandscape: Boolean,
    val appInfo: AppInfo?,
    val gkdAppInfo: AppInfo,
    val device: DeviceInfo,
    val nodes: List<SnapshotNode>,
    val screenshot: ScreenshotStatus,
)

data class ScreenshotStatus(
    val ok: Boolean,
    val code: String? = null,
    val bytes: Int = 0,
)
