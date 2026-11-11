package com.zeta.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

sealed class SessionCheck {
    data class Valid(val csrf: String) : SessionCheck()
    data object Unauthorized : SessionCheck()
    data object TotpRequired : SessionCheck()
    data class NetworkError(val message: String) : SessionCheck()
    data class ServerError(val message: String) : SessionCheck()
}

sealed class TotpResult {
    data object Ok : TotpResult()
    data object Invalid : TotpResult()
    data object RateLimited : TotpResult()
    data class NetworkError(val message: String) : TotpResult()
    data class ServerError(val message: String) : TotpResult()
}

class SessionVerifier(
    private val client: OkHttpClient,
    private val store: SecureCredentialStore,
) {
    /**
     * Native-side session validity check. This is deliberately separate from
     * the WebView: the shell must not load a 401 page and call it a session.
     */
    suspend fun verify(credential: Credential): SessionCheck = withContext(Dispatchers.IO) {
        val request = authorizedRequest(credential, "/api/v1/bootstrap")
            .get()
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return@withContext SessionCheck.NetworkError(error.message ?: "network")
        }
        response.use { result ->
            val csrf = result.header("X-Studio-CSRF").orEmpty()
            when {
                result.isSuccessful -> {
                    if (csrf.isNotBlank()) {
                        runCatching { store.save(credential.withCsrf(csrf)) }
                    }
                    SessionCheck.Valid(csrf.ifBlank { credential.csrf })
                }
                result.code == 401 -> SessionCheck.Unauthorized
                result.code == 403 && errorName(result.body?.string().orEmpty()) == "totp_required" ->
                    SessionCheck.TotpRequired
                else -> SessionCheck.ServerError("http_${result.code}")
            }
        }
    }

    suspend fun verifyTotp(credential: Credential, code: String): TotpResult =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("code", code.trim()).toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = authorizedRequest(credential, "/api/auth/2fa/verify")
                .post(body)
                .build()
            val response = try {
                client.newCall(request).execute()
            } catch (error: IOException) {
                return@withContext TotpResult.NetworkError(error.message ?: "network")
            }
            response.use { result ->
                when {
                    result.isSuccessful -> TotpResult.Ok
                    result.code == 401 -> TotpResult.Invalid
                    result.code == 429 -> TotpResult.RateLimited
                    else -> TotpResult.ServerError("http_${result.code}")
                }
            }
        }

    suspend fun revokeSession(credential: Credential) {
        withContext(Dispatchers.IO) {
            val request = authorizedRequest(credential, "/api/v1/session/revoke")
                .post(EMPTY_JSON)
                .build()
            runCatching { client.newCall(request).execute().close() }
        }
    }

    private fun authorizedRequest(credential: Credential, path: String): Request.Builder {
        val builder = Request.Builder()
            .url(credential.host.apiUrl(path))
            .header("Accept", "application/json")
            .header("X-Zeta-Client", "android-native")
        val token = credential.deviceToken
        if (credential.sessionCookie.isNotBlank()) {
            builder.header("Cookie", credential.nativeCookieHeader)
        } else if (!token.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $token")
        }
        if (credential.csrf.isNotBlank()) builder.header("X-Studio-CSRF", credential.csrf)
        return builder
    }

    private fun errorName(body: String): String {
        return try {
            JSONObject(body).optString("error")
        } catch (_: Exception) {
            ""
        }
    }

    private companion object {
        val EMPTY_JSON = "{}".toRequestBody("application/json; charset=utf-8".toMediaType())
    }
}
