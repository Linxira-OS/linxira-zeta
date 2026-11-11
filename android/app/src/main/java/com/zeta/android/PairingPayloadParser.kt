package com.zeta.android

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

data class PairingPayload(
    val host: HostTarget,
    val code: String,
)

sealed class PairingPayloadException(message: String) : Exception(message) {
    class Invalid(message: String = "invalid pairing payload") : PairingPayloadException(message)
    class Legacy(message: String = "legacy machine-token payload") : PairingPayloadException(message)
}

/**
 * Parses the current `https://host/#zeta-pair=<code>` payload. The legacy
 * `#zeta-token=` fragment is recognized only so it can be rejected with a
 * clear message; a machine token is never accepted as a pairing code.
 */
object PairingPayloadParser {
    private const val CODE_KEY = "zeta-pair"
    private const val LEGACY_KEY = "zeta-token"
    private const val MAX_CODE_LENGTH = 128

    fun parse(raw: String): PairingPayload {
        val uri = try {
            URI(raw.trim())
        } catch (_: Exception) {
            throw PairingPayloadException.Invalid()
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) throw PairingPayloadException.Invalid()
        if (uri.userInfo != null || uri.query != null) throw PairingPayloadException.Invalid()
        val fragment = uri.rawFragment ?: throw PairingPayloadException.Invalid()
        val params = fragmentParams(fragment)
        if (params.containsKey(LEGACY_KEY)) throw PairingPayloadException.Legacy()
        val code = params[CODE_KEY]?.trim().orEmpty()
        if (code.isEmpty() || code.length > MAX_CODE_LENGTH || code.any { it.isWhitespace() }) {
            throw PairingPayloadException.Invalid()
        }
        val hostUrl = uri.toASCIIString().substringBefore('#')
        val host = HostPolicy.parse(hostUrl) ?: throw PairingPayloadException.Invalid()
        return PairingPayload(host, code)
    }

    private fun fragmentParams(fragment: String): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        if (fragment.isEmpty()) return result
        for (part in fragment.split('&')) {
            if (part.isEmpty()) continue
            val separator = part.indexOf('=')
            val rawKey = if (separator >= 0) part.substring(0, separator) else part
            val rawValue = if (separator >= 0) part.substring(separator + 1) else ""
            val key = decode(rawKey)
            val value = decode(rawValue)
            if (key.isEmpty()) throw PairingPayloadException.Invalid()
            if (result.put(key, value) != null) throw PairingPayloadException.Invalid()
        }
        return result
    }

    private fun decode(value: String): String {
        return try {
            URLDecoder.decode(value, StandardCharsets.UTF_8.name())
        } catch (_: IllegalArgumentException) {
            throw PairingPayloadException.Invalid()
        }
    }
}
