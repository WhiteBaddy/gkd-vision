package dev.everything.vision.server

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.view.WindowManager
import dev.everything.vision.model.AppInfo
import dev.everything.vision.model.DeviceInfo

object Env {
    fun device(): DeviceInfo = DeviceInfo(
        device = Build.DEVICE,
        model = Build.MODEL,
        manufacturer = Build.MANUFACTURER,
        brand = Build.BRAND,
        sdkInt = Build.VERSION.SDK_INT,
        release = Build.VERSION.RELEASE,
    )

    fun selfApp(context: Context): AppInfo = appInfo(context, context.packageName)

    @Suppress("DEPRECATION")
    fun appInfo(context: Context, packageName: String?): AppInfo {
        val pm = context.packageManager
        if (packageName != null) {
            try {
                val info = pm.getPackageInfo(packageName, 0)
                val label = pm.getApplicationLabel(info.applicationInfo).toString()
                val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
                return AppInfo(packageName, label, code, info.versionName ?: "")
            } catch (_: PackageManager.NameNotFoundException) {
                // fall through
            }
        }
        val id = packageName ?: "unknown"
        return AppInfo(id, id, 0, "")
    }

    fun screenSize(context: Context): Pair<Int, Int> {
        val wm = context.getSystemService(WindowManager::class.java)
        val bounds = wm.currentWindowMetrics.bounds
        return bounds.width() to bounds.height()
    }
}
