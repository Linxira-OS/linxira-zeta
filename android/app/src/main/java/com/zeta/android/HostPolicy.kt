package com.zeta.android

import java.net.URI

/**
 * A paired host's fixed origin. Work Studio is served at the origin root; a
 * reverse-proxy path prefix is rejected rather than pretended to work, because
 * the renderer and `/api/v1` contract address the root. The client never
 * accepts a second origin or a cleartext URL.
 */
data class HostTarget(
    val origin: String,
    val baseUrl: String,
    val host: String,
    val port: Int,
) {
    fun apiUrl(path: String): String {
        require(path.startsWith("/")) { "API path must start with /" }
        return origin + path
    }

    fun isSameOrigin(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val candidate = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        if (!candidate.scheme.equals("https", ignoreCase = true)) return false
        if (candidate.userInfo != null) return false
        val candidateHost = canonicalHost(candidate.host ?: return false)
        val candidatePort = if (candidate.port == -1) 443 else candidate.port
        return candidateHost.equals(host, ignoreCase = true) && candidatePort == port
    }
}

object HostPolicy {
    private const val DEFAULT_HTTPS_PORT = 443

    /** Add https:// to a bare host input; never accepts an http:// result. */
    fun normalizeInput(raw: String): String {
        val trimmed = raw.trim()
        return if (trimmed.contains("://")) trimmed else "https://$trimmed"
    }

    /**
     * Parse a fixed origin. Only https, a host (including bracketed IPv6), an
     * optional explicit port, and the root path are accepted. Query, fragment,
     * user info, traversal, and any reverse-proxy path prefix are rejected —
     * a base path would make `/api/v1` 404 while looking supported.
     */
    fun parse(raw: String): HostTarget? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        val uri = try {
            URI(trimmed)
        } catch (_: Exception) {
            return null
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) return null
        if (uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        val rawHost = uri.host ?: return null
        val host = canonicalHost(rawHost)
        if (host.isEmpty()) return null
        val port = if (uri.port == -1) DEFAULT_HTTPS_PORT else uri.port
        if (port !in 1..65535) return null
        val rawPath = uri.rawPath ?: ""
        if (rawPath.isNotEmpty() && rawPath != "/") return null
        val originHost = if (host.contains(':')) "[$host]" else host
        val origin = if (port == DEFAULT_HTTPS_PORT) {
            "https://$originHost"
        } else {
            "https://$originHost:$port"
        }
        return HostTarget(origin, "$origin/", host, port)
    }

    /** Links the shell may hand to another app after an explicit confirmation. */
    fun isSafeExternal(url: String): Boolean {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return false
        }
        val scheme = uri.scheme?.lowercase() ?: return false
        return scheme == "https" || scheme == "mailto" || scheme == "tel"
    }

    private fun canonicalHost(raw: String): String {
        return raw.removePrefix("[").removeSuffix("]").lowercase()
    }
}
