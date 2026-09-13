package com.graciebarra.roundtimer.tv

import android.content.res.AssetManager
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import java.util.Collections
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The phone controller, served by the TV.
 *
 * Speaks the same `/api` routes as the Windows build, so a phone that used to point at
 * the gym laptop works here untouched — same pairing code, same payloads, same pages.
 * Written directly against java.net rather than a web framework: the whole thing is one
 * accept loop and a handful of routes, and it has to survive on a TV stick.
 */
class TimerServer(
    private val assets: AssetManager,
    private val engine: TimerEngine,
    private val onConfigApplied: (TimerConfig) -> Unit = {}
) {
    companion object {
        private const val TAG = "TimerServer"
        const val PREFERRED_PORT = 8765
        private const val PORT_ATTEMPTS = 10
        private const val MAX_BODY = 8 * 1024
        private const val SOCKET_TIMEOUT_MS = 15_000

        private val CSP =
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
                "connect-src 'self'; base-uri 'none'; form-action 'self'"

        private val ASSET_NAME = Regex("^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?\\.[a-z0-9]+$")

        private val TYPES = mapOf(
            "html" to "text/html; charset=utf-8",
            "css" to "text/css; charset=utf-8",
            "js" to "application/javascript; charset=utf-8",
            "png" to "image/png",
            "mp3" to "audio/mpeg",
            "svg" to "image/svg+xml",
            "json" to "application/json; charset=utf-8"
        )
    }

    private val random = SecureRandom()
    private val pairedSessions = Collections.synchronizedSet(mutableSetOf<String>())
    private val assetCache = HashMap<String, ByteArray>()
    private val workers = Executors.newFixedThreadPool(6) { runnable ->
        Thread(runnable, "gb-timer-http").apply { isDaemon = true }
    }

    /** Six digits, shown on the TV and typed into the phone once. */
    val pin: String = String.format(Locale.US, "%06d", random.nextInt(1_000_000))

    @Volatile private var socket: ServerSocket? = null
    @Volatile private var running = false
    var port: Int = PREFERRED_PORT
        private set

    /** Binds the first free port at or after 8765; returns null when they are all taken. */
    fun start(): Int? {
        for (offset in 0 until PORT_ATTEMPTS) {
            val candidate = PREFERRED_PORT + offset
            try {
                val bound = ServerSocket(candidate, 24)
                socket = bound
                port = candidate
                running = true
                Thread({ acceptLoop(bound) }, "gb-timer-accept").apply { isDaemon = true }.start()
                Log.i(TAG, "listening on $candidate")
                return candidate
            } catch (_: IOException) {
                /* Another copy of the app, or another app entirely. Try the next one. */
            }
        }
        Log.e(TAG, "no free port between $PREFERRED_PORT and ${PREFERRED_PORT + PORT_ATTEMPTS - 1}")
        return null
    }

    fun stop() {
        running = false
        try { socket?.close() } catch (_: IOException) {}
        socket = null
        workers.shutdownNow()
        try { workers.awaitTermination(1, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
    }

    private fun acceptLoop(bound: ServerSocket) {
        while (running) {
            val client = try { bound.accept() } catch (_: IOException) { if (running) continue else break }
            try {
                workers.execute { serve(client) }
            } catch (_: Exception) {
                try { client.close() } catch (_: IOException) {}
            }
        }
    }

    private fun serve(client: Socket) {
        try {
            client.soTimeout = SOCKET_TIMEOUT_MS
            client.tcpNoDelay = true
            val input = client.getInputStream()
            val output = client.getOutputStream()
            val head = readHead(input) ?: return
            val lines = head.split("\r\n")
            val request = lines.firstOrNull()?.split(" ") ?: return
            if (request.size < 2) return

            val method = request[0]
            val target = request[1].substringBefore('?')
            val headers = lines.drop(1).mapNotNull { line ->
                val colon = line.indexOf(':')
                if (colon <= 0) null else line.take(colon).lowercase(Locale.US) to line.substring(colon + 1).trim()
            }.toMap()

            var session = sessionCookie(headers["cookie"])
            var setCookie: String? = null
            if (session == null) {
                session = randomHex(16)
                setCookie = "session=$session; HttpOnly; SameSite=Strict; Path=/"
            }

            /* The TV's own WebView reaches the server over loopback. That is this
               screen, not a stranger's phone, so it never has to type its own code.
               X-Timer-Pin carries the same code a controller would have paired with,
               for clients whose cookie jar does not survive talking to another box. */
            val trusted = client.inetAddress?.isLoopbackAddress == true ||
                pairedSessions.contains(session) ||
                headers["x-timer-pin"] == pin

            val body = if (method == "POST") readBody(input, headers["content-length"]?.toIntOrNull() ?: 0) else null
            respond(output, method, target, session, setCookie, trusted, body, client.inetAddress)
            output.flush()
        } catch (_: IOException) {
            /* A TV browser dropping a poll mid-flight is ordinary. */
        } catch (error: Exception) {
            Log.w(TAG, "request failed", error)
        } finally {
            try { client.close() } catch (_: IOException) {}
        }
    }

    private fun respond(
        output: OutputStream,
        method: String,
        target: String,
        session: String,
        setCookie: String?,
        trusted: Boolean,
        body: String?,
        from: InetAddress?
    ) {
        if (method == "GET") {
            when (target) {
                "/", "/display", "/control" -> return sendAsset(output, "web/index.html", "html", setCookie)
                "/api/state" -> return send(output, 200, "OK", TYPES["json"]!!, stateJson(trusted).toByteArray(), setCookie)
            }
            /* One directory deep, letters digits and dashes only: enough for
               buzzers/boxing-bell-3.mp3 and nothing that can climb out of web/. */
            val name = target.trimStart('/')
            if (ASSET_NAME.matches(name)) {
                val extension = name.substringAfterLast('.', "")
                val type = TYPES[extension]
                if (type != null && asset("web/$name") != null) return sendAsset(output, "web/$name", extension, setCookie)
            }
            return sendJson(output, 404, "Not Found", """{"error":"Not found"}""", setCookie)
        }

        if (method != "POST") return sendJson(output, 405, "Method Not Allowed", """{"error":"Not found"}""", setCookie)

        val payload = try { JSONObject(body ?: "{}") } catch (_: Exception) {
            return sendJson(output, 400, "Bad Request", """{"error":"Invalid request"}""", setCookie)
        }

        if (target == "/api/pair") {
            return if (payload.optString("pin") == pin) {
                pairedSessions.add(session)
                Log.i(TAG, "paired a controller from ${from?.hostAddress}")
                sendJson(output, 200, "OK", """{"ok":true}""", setCookie)
            } else {
                sendJson(output, 403, "Forbidden", """{"error":"Incorrect access code"}""", setCookie)
            }
        }

        if (!trusted) return sendJson(output, 403, "Forbidden", """{"error":"Pair this device first"}""", setCookie)

        return when (target) {
            "/api/action" ->
                if (engine.action(payload.optString("action"))) sendJson(output, 200, "OK", """{"ok":true}""", setCookie)
                else sendJson(output, 400, "Bad Request", """{"error":"Unknown action"}""", setCookie)

            "/api/config" -> {
                val next = TimerEngine.sanitise(
                    preset = payload.optString("preset", "custom"),
                    round = payload.optInt("round", -1),
                    rest = payload.optInt("rest", -1),
                    rounds = payload.optInt("rounds", -1),
                    position = payload.optString("position", ""),
                    alternate = payload.optBoolean("alternate", false),
                    warning = payload.optBoolean("warning", false),
                    buzzer = payload.optString("buzzer", "classic"),
                    volume = payload.optDouble("buzzer_volume", 0.8)
                )
                if (engine.apply(next)) {
                    onConfigApplied(next!!)
                    sendJson(output, 200, "OK", """{"ok":true}""", setCookie)
                } else {
                    sendJson(output, 400, "Bad Request", """{"error":"Invalid settings"}""", setCookie)
                }
            }

            else -> sendJson(output, 404, "Not Found", """{"error":"Not found"}""", setCookie)
        }
    }

    private fun stateJson(paired: Boolean): String =
        StateJson.render(engine.snapshot(), paired, pin, localUrls(), System.currentTimeMillis())

    /** Every address a phone on the gym Wi-Fi could reach this TV on. */
    fun localUrls(): List<String> {
        val urls = mutableListOf<String>()
        try {
            for (network in Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!network.isUp || network.isLoopback) continue
                for (address in Collections.list(network.inetAddresses)) {
                    if (address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress) {
                        urls.add("http://${address.hostAddress}:$port/control")
                    }
                }
            }
        } catch (error: Exception) {
            Log.w(TAG, "could not list addresses", error)
        }
        return urls
    }

    private fun sendAsset(output: OutputStream, path: String, extension: String, setCookie: String?) {
        val bytes = asset(path)
        if (bytes == null) return sendJson(output, 404, "Not Found", """{"error":"Not found"}""", setCookie)
        send(output, 200, "OK", TYPES[extension] ?: "application/octet-stream", bytes, setCookie)
    }

    private fun sendJson(output: OutputStream, status: Int, reason: String, json: String, setCookie: String?) =
        send(output, status, reason, TYPES["json"]!!, json.toByteArray(), setCookie)

    private fun send(output: OutputStream, status: Int, reason: String, type: String, body: ByteArray, setCookie: String?) {
        val header = buildString {
            append("HTTP/1.1 $status $reason\r\n")
            append("Content-Type: $type\r\n")
            append("Content-Length: ${body.size}\r\n")
            append("Connection: close\r\n")
            append("Cache-Control: no-store\r\n")
            append("X-Content-Type-Options: nosniff\r\n")
            append("Content-Security-Policy: $CSP\r\n")
            if (setCookie != null) append("Set-Cookie: $setCookie\r\n")
            append("\r\n")
        }
        output.write(header.toByteArray())
        output.write(body)
    }

    private fun asset(path: String): ByteArray? {
        synchronized(assetCache) { assetCache[path]?.let { return it } }
        val bytes = try {
            assets.open(path).use { stream -> stream.readBytesCompat() }
        } catch (_: IOException) {
            return null
        }
        synchronized(assetCache) { assetCache[path] = bytes }
        return bytes
    }

    private fun readHead(input: InputStream): String? {
        val buffer = ByteArrayOutputStream()
        var matched = 0
        while (buffer.size() < 16 * 1024) {
            val byte = input.read()
            if (byte < 0) return null
            buffer.write(byte)
            matched = when {
                byte == '\r'.code && (matched == 0 || matched == 2) -> matched + 1
                byte == '\n'.code && (matched == 1 || matched == 3) -> matched + 1
                else -> 0
            }
            if (matched == 4) return String(buffer.toByteArray()).trimEnd('\r', '\n')
        }
        return null
    }

    private fun readBody(input: InputStream, length: Int): String {
        if (length <= 0 || length > MAX_BODY) return ""
        val bytes = ByteArray(length)
        var read = 0
        while (read < length) {
            val count = input.read(bytes, read, length - read)
            if (count < 0) break
            read += count
        }
        return String(bytes, 0, read)
    }

    private fun sessionCookie(cookie: String?): String? {
        if (cookie == null) return null
        for (part in cookie.split(';')) {
            val trimmed = part.trim()
            if (trimmed.startsWith("session=")) {
                val value = trimmed.removePrefix("session=")
                if (value.length == 32 && value.all { it in '0'..'9' || it in 'a'..'f' }) return value
            }
        }
        return null
    }

    private fun randomHex(bytes: Int): String {
        val buffer = ByteArray(bytes)
        random.nextBytes(buffer)
        return buffer.joinToString("") { String.format(Locale.US, "%02x", it) }
    }

    private fun InputStream.readBytesCompat(): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(16 * 1024)
        while (true) {
            val count = read(chunk)
            if (count < 0) break
            buffer.write(chunk, 0, count)
        }
        return buffer.toByteArray()
    }
}
