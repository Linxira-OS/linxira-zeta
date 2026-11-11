package com.zeta.android

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

/** One authenticated Studio event, reduced to the fields notifications need. */
data class HostEvent(
    val authorityEpoch: String,
    val cursor: Long,
    val kind: String,
    val sessionId: String?,
    val interactionTitle: String?,
    val commandName: String?,
    val receiptStatus: String?,
    val conversationKind: String?,
)

/**
 * Native subscription to the existing `WS /api/v1/events` surface. It uses the
 * same device-bound cookie/token as the WebView, sends the standard `{scope}`
 * frame, and deduplicates by `authorityEpoch + cursor`. It does not invent a
 * protocol and never sends commands; the only outbound frame is `scope`.
 */
class HostEventStream(
    private val client: OkHttpClient,
    private val credential: Credential,
    private val listener: Listener,
) {
    interface Listener {
        fun onEvent(event: HostEvent)
        fun onClosed(reason: String)
    }

    private val lock = Any()
    private var socket: WebSocket? = null
    private var closed = false
    private var lastAuthority: String? = null
    private var lastCursor: Long = 0L

    fun connect() {
        val request = Request.Builder()
            .url(credential.host.apiUrl("/api/v1/events").replaceFirst("https://", "wss://"))
            .header("X-Zeta-Client", "android-native")
            .apply {
                // Use the same studio_session as the WebView so command
                // receipts/interactions emitted for the page's session reach
                // this socket. A device token authenticates but is stateless
                // (session id ""), so it would not share that stream.
                if (credential.sessionCookie.isNotBlank()) {
                    header("Cookie", credential.nativeCookieHeader)
                } else {
                    credential.deviceToken?.takeIf { it.isNotBlank() }?.let {
                        header("Authorization", "Bearer $it")
                    }
                }
            }
            .build()
        synchronized(lock) {
            if (closed || socket != null) return
            socket = client.newWebSocket(request, socketListener)
        }
    }

    fun close() {
        synchronized(lock) {
            closed = true
            socket?.close(NORMAL_CLOSURE, "client background ended")
            socket = null
        }
    }

    private val socketListener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send("""{"scope":{"scope":"all"}}""")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val event = parse(text) ?: return
            synchronized(lock) {
                if (closed) return
                if (event.authorityEpoch != lastAuthority) {
                    lastAuthority = event.authorityEpoch
                    lastCursor = 0L
                }
                if (event.cursor in 1..lastCursor) return
                if (event.cursor > lastCursor) lastCursor = event.cursor
            }
            listener.onEvent(event)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            synchronized(lock) { socket = null }
            listener.onClosed(reason.ifBlank { "closed:$code" })
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            synchronized(lock) { socket = null }
            listener.onClosed(t.message ?: "socket_failure")
        }
    }

    private fun parse(text: String): HostEvent? {
        val json = try {
            JSONObject(text)
        } catch (_: Exception) {
            return null
        }
        val kind = json.optString("kind")
        if (kind.isBlank()) return null
        val cursor = json.optString("cursor").toLongOrNull() ?: return null
        val authority = json.optString("authorityEpoch")
        val interaction = json.optJSONObject("interaction")
        val receipt = json.optJSONObject("receipt")
        val update = json.optJSONObject("update")
        return HostEvent(
            authorityEpoch = authority,
            cursor = cursor,
            kind = kind,
            sessionId = json.optString("sessionId").takeIf { it.isNotBlank() },
            interactionTitle = interaction?.optString("title")?.takeIf { it.isNotBlank() },
            commandName = receipt?.optString("commandName")?.takeIf { it.isNotBlank() },
            receiptStatus = receipt?.optString("status")?.takeIf { it.isNotBlank() },
            conversationKind = update?.optString("kind")?.takeIf { it.isNotBlank() },
        )
    }

    private companion object {
        const val NORMAL_CLOSURE = 1000
    }
}
