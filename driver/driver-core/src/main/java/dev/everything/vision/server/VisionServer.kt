package dev.everything.vision.server

import dev.everything.vision.A11yService
import dev.everything.vision.action.ActionExecutor
import dev.everything.vision.json.SnapshotJson
import dev.everything.vision.model.ScreenshotStatus
import dev.everything.vision.model.Snapshot
import dev.everything.vision.snapshot.AndroidNodeSource
import dev.everything.vision.snapshot.SnapshotBuilder
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import android.util.Log
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/**
 * 仅监听 127.0.0.1 的最小 HTTP 服务，端点形状对齐 GKD：
 * /api/state、/api/getServerInfo、/api/captureSnapshot、/api/getScreenshot。
 */
class VisionServer(
    private val service: A11yService,
    private val port: Int = DEFAULT_PORT,
) {
    private val builder = SnapshotBuilder()
    private val actions = ActionExecutor(service)
    private val sequence = AtomicInteger(0)
    private val screenshots = object : LinkedHashMap<Int, ByteArray>(4, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, ByteArray>): Boolean = size > 4
    }

    @Volatile
    private var running = false

    @Volatile
    private var serverSocket: ServerSocket? = null

    @Volatile
    var lastError: String? = null
        private set

    @Volatile
    var isRunning: Boolean = false
        private set

    fun start() {
        if (running) return
        running = true
        Thread({ acceptLoop() }, "vision-http").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        isRunning = false
        try {
            serverSocket?.close()
        } catch (_: Throwable) {
            // ignore
        }
        serverSocket = null
    }

    private fun acceptLoop() {
        try {
            val socket = ServerSocket()
            socket.reuseAddress = true
            socket.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
            serverSocket = socket
            isRunning = true
            while (running) {
                val client =
                    try {
                        socket.accept()
                    } catch (_: Throwable) {
                        if (!running) break else continue
                    }
                try {
                    client.use { handle(it) }
                } catch (t: Throwable) {
                    lastError = "handle failed: ${t.message}"
                }
            }
        } catch (t: Throwable) {
            lastError = "bind failed: ${t.message}"
            Log.e("VisionDriver", "http server failed", t)
        }
    }

    private fun handle(client: Socket) {
        client.soTimeout = 10000
        val request = try {
            readRequest(client.getInputStream())
        } catch (_: Throwable) {
            null
        } ?: return
        val response = try {
            route(request)
        } catch (t: Throwable) {
            errorResponseFor(t)
        }
        try {
            writeResponse(client.getOutputStream(), response)
        } catch (_: Throwable) {
            // client gone
        }
    }

    private fun route(request: HttpRequest): HttpResponse = when (request.path) {
        "/api/state" -> json(stateJson())
        "/api/getServerInfo" -> json(serverInfoJson())
        "/api/captureSnapshot" -> json(captureSnapshot())
        "/api/getScreenshot" -> screenshotResponse(request.body)
        "/api/execSelector" -> json(actions.exec(parseBody(request.body)))
        "/api/text" -> json(actions.setText(parseBody(request.body)))
        "/api/deleteSnapshot" -> json(JSONObject().put("message", "success"))
        "/api/getSnapshots" -> json(org.json.JSONArray())
        else -> HttpResponse(
            status = 404,
            body = errorBody("NOT_FOUND", "unknown path ${request.path}"),
            rpcStatus = "error",
        )
    }

    private fun stateJson(): JSONObject = JSONObject().apply {
        put("status", if (service.isConnected()) "ok" else "disconnected")
        put("port", port)
        put("app", Env.selfApp(service).id)
        put("version", Env.selfApp(service).versionName)
        put("lastError", lastError ?: JSONObject.NULL)
        put("snapshotCount", sequence.get())
        put("screenshotCache", synchronized(screenshots) { screenshots.size })
        put("lastPackage", service.lastPackage ?: JSONObject.NULL)
        put("lastClass", service.lastClass ?: JSONObject.NULL)
        put("imeVisible", service.isImeVisible())
    }

    private fun serverInfoJson(): JSONObject = JSONObject().apply {
        put("device", SnapshotJson.deviceJson(Env.device()))
        put("gkdAppInfo", SnapshotJson.appJson(Env.selfApp(service)))
    }

    private fun captureSnapshot(): JSONObject {
        val root = service.activeRoot()
            ?: return errorObject("NODES_UNAVAILABLE", "无法读取当前窗口节点")
        val nodes = builder.build(AndroidNodeSource(root, 0))
        val (width, height) = Env.screenSize(service)
        val appId = root.packageName?.toString() ?: service.lastPackage ?: "unknown"
        val id = sequence.incrementAndGet()
        val bytes = Screenshotter.capture(service)
        if (bytes != null) {
            synchronized(screenshots) { screenshots[id] = bytes }
        }
        val snapshot = Snapshot(
            id = id,
            appId = appId,
            activityId = service.lastClass,
            screenWidth = width,
            screenHeight = height,
            isLandscape = width > height,
            appInfo = Env.appInfo(service, appId),
            gkdAppInfo = Env.selfApp(service),
            device = Env.device(),
            nodes = nodes,
            screenshot = ScreenshotStatus(
                ok = bytes != null,
                code = if (bytes == null) "SCREENSHOT_FAILED" else null,
                bytes = bytes?.size ?: 0,
            ),
        )
        return SnapshotJson.toJson(snapshot)
    }

    private fun screenshotResponse(body: ByteArray): HttpResponse {
        val id = try {
            JSONObject(String(body, Charsets.UTF_8)).optInt("id", -1)
        } catch (_: Throwable) {
            -1
        }
        val bytes = synchronized(screenshots) { screenshots[id] }
            ?: return errorResponse("SNAPSHOT_NOT_FOUND", "没有该快照的截图: $id")
        return HttpResponse(contentType = "image/webp", body = bytes)
    }

    private fun parseBody(body: ByteArray): JSONObject =
        try {
            JSONObject(String(body, Charsets.UTF_8).ifBlank { "{}" })
        } catch (t: Throwable) {
            throw IllegalArgumentException("请求体不是合法 JSON: ${t.message}")
        }

    private fun errorResponseFor(t: Throwable): HttpResponse {
        val code = when (t) {
            is IllegalArgumentException -> "INVALID_ARGUMENT"
            is IllegalStateException -> "NODE_NOT_FOUND"
            is SecurityException -> "PERMISSION_DENIED"
            else -> "INTERNAL_ERROR"
        }
        return errorResponse(code, t.message ?: code)
    }

    private fun json(obj: JSONObject): HttpResponse =
        HttpResponse(body = obj.toString().toByteArray(Charsets.UTF_8))

    private fun errorObject(code: String, message: String): JSONObject = JSONObject().apply {
        put("code", code)
        put("message", message)
    }

    private fun errorBody(code: String, message: String): ByteArray =
        errorObject(code, message).toString().toByteArray(Charsets.UTF_8)

    private fun errorResponse(code: String, message: String): HttpResponse =
        HttpResponse(body = errorBody(code, message), rpcStatus = "error")

    companion object {
        const val DEFAULT_PORT = 8899
    }
}
