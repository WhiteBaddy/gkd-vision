package dev.everything.vision.server

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.view.Display
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** 基于 AccessibilityService.takeScreenshot 的截图，编码 WebP。 */
object Screenshotter {
    fun capture(service: AccessibilityService, quality: Int = 70, timeoutMs: Long = 3000): ByteArray? {
        val latch = CountDownLatch(1)
        val holder = AtomicReference<ByteArray?>(null)
        val executor = Executors.newSingleThreadExecutor()
        try {
            service.takeScreenshot(
                Display.DEFAULT_DISPLAY,
                executor,
                object : AccessibilityService.TakeScreenshotCallback {
                    override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
                        try {
                            val buffer = result.hardwareBuffer
                            try {
                                val bitmap = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace) ?: return
                                val software =
                                    if (bitmap.config == Bitmap.Config.HARDWARE) {
                                        bitmap.copy(Bitmap.Config.ARGB_8888, false)
                                    } else {
                                        bitmap
                                    }
                                ByteArrayOutputStream().use { out ->
                                    software.compress(Bitmap.CompressFormat.WEBP_LOSSY, quality, out)
                                    holder.set(out.toByteArray())
                                }
                                if (software !== bitmap) software.recycle()
                                bitmap.recycle()
                            } finally {
                                buffer.close()
                            }
                        } catch (_: Throwable) {
                            // 受保护窗口 / 编码失败：返回 null，由调用方转成错误码
                        } finally {
                            latch.countDown()
                        }
                    }

                    override fun onFailure(errorCode: Int) {
                        latch.countDown()
                    }
                },
            )
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (_: Throwable) {
            // SecurityException 等
        } finally {
            executor.shutdown()
        }
        return holder.get()
    }
}
