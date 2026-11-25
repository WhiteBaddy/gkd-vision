package dev.everything.vision.server

import android.content.Context
import java.io.File
import java.security.SecureRandom

/**
 * 本地 HTTP 的访问令牌：首次启动生成 32 位十六进制，写入应用私有目录（0600）。
 * Termux 侧通过 root 读取该文件后随请求发送 X-Vision-Token。
 */
object TokenStore {
    private const val FILE_NAME = "vision.token"

    fun ensure(context: Context): String {
        val file = File(context.filesDir, FILE_NAME)
        runCatching {
            if (file.exists()) {
                val existing = file.readText().trim()
                if (existing.length >= 32) return existing
            }
        }
        val token = ByteArray(16)
            .also { SecureRandom().nextBytes(it) }
            .joinToString("") { "%02x".format(it) }
        file.parentFile?.mkdirs()
        file.writeText(token)
        runCatching {
            file.setReadable(false, false)
            file.setWritable(false, false)
            file.setExecutable(false, false)
            file.setReadable(true, true)
            file.setWritable(true, true)
        }
        return token
    }
}
