package com.zeta.android

/**
 * The persisted result of one pairing. The session cookie is the browser
 * credential (HttpOnly, Secure, SameSite=Strict); the optional device token is
 * for native calls only and never enters page JavaScript.
 */
data class Credential(
    val host: HostTarget,
    val sessionCookie: String,
    val csrf: String,
    val deviceId: String,
    val deviceToken: String?,
    val bindingWorkspaceId: String,
    val bindingSessionId: String?,
    val scopes: Set<String>,
    val createdAt: Long,
) {
    val hasDeviceToken: Boolean
        get() = !deviceToken.isNullOrBlank()

    val webViewCookie: String
        get() = "studio_session=$sessionCookie; Path=/; Secure; HttpOnly; SameSite=Strict"

    val nativeCookieHeader: String
        get() = "studio_session=$sessionCookie"

    val bindingDescription: String
        get() = bindingWorkspaceId

    fun withCsrf(value: String): Credential = if (value.isBlank() || value == csrf) this else copy(csrf = value)
}
