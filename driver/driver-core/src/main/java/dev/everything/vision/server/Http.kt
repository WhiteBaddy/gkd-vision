package dev.everything.vision.server

import java.io.InputStream
import java.io.OutputStream

class HttpRequest(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: ByteArray,
)

class HttpResponse(
    val status: Int = 200,
    val contentType: String = "application/json; charset=utf-8",
    val body: ByteArray = ByteArray(0),
    val rpcStatus: String? = "ok",
)

fun readRequest(input: InputStream): HttpRequest? {
    val head = readUntilBlankLine(input) ?: return null
    val lines = head.split("\r\n")
    if (lines.isEmpty()) return null
    val parts = lines[0].split(" ")
    if (parts.size < 2) return null
    val headers = HashMap<String, String>()
    for (line in lines.drop(1)) {
        val idx = line.indexOf(':')
        if (idx <= 0) continue
        headers[line.substring(0, idx).trim().lowercase()] = line.substring(idx + 1).trim()
    }
    val length = (headers["content-length"]?.toIntOrNull() ?: 0).coerceAtLeast(0).coerceAtMost(1 shl 20)
    val body = ByteArray(length)
    var read = 0
    while (read < length) {
        val n = input.read(body, read, length - read)
        if (n < 0) break
        read += n
    }
    return HttpRequest(
        method = parts[0].uppercase(),
        path = parts[1].substringBefore('?'),
        headers = headers,
        body = if (read == length) body else body.copyOf(read),
    )
}

private fun readUntilBlankLine(input: InputStream): String? {
    val out = StringBuilder()
    var tail = 0
    while (true) {
        val b = input.read()
        if (b < 0) return if (out.isEmpty()) null else out.toString()
        out.append(b.toChar())
        tail = (tail shl 8) or b
        if (tail == 0x0D0A0D0A) break
        if (out.length > 16 * 1024) break
    }
    return out.toString().removeSuffix("\r\n\r\n")
}

fun writeResponse(output: OutputStream, response: HttpResponse) {
    val header = buildString {
        append("HTTP/1.1 ${response.status} ${if (response.status == 200) "OK" else "Error"}\r\n")
        append("Content-Type: ${response.contentType}\r\n")
        append("Content-Length: ${response.body.size}\r\n")
        append("Connection: close\r\n")
        append("Cache-Control: no-store\r\n")
        if (response.rpcStatus != null) append("GKD-RPC-Status: ${response.rpcStatus}\r\n")
        append("\r\n")
    }
    output.write(header.toByteArray(Charsets.US_ASCII))
    output.write(response.body)
    output.flush()
}
