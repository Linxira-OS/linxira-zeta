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


data class AgentState(
    val sessionId: String,
    val isStreaming: Boolean,
    val pendingInteractionId: String?,
    val pendingInteractionTitle: String?,
    val lastTurnOutcome: String?,
    val stateVersion: Long,
)

sealed class StateCheck {
    data class Ok(val state: AgentState) : StateCheck()
    data object Unauthorized : StateCheck()
    data class Forbidden(val reason: String) : StateCheck()
    data class NetworkError(val message: String) : StateCheck()
    data class ServerError(val message: String) : StateCheck()
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

    /**
     * Read the current user state under the device's workspace binding. The
     * binding id is carried in the existing query input so the host's
     * binding guard can intersect it; `session.state` itself ignores input.
     */
    suspend fun queryState(credential: Credential): StateCheck = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("queryName", "session.state")
            .put("input", JSONObject().put("workspaceId", credential.bindingWorkspaceId))
            .toString()
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = authorizedRequest(credential, "/api/v1/query")
            .post(body)
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (error: IOException) {
            return@withContext StateCheck.NetworkError(error.message ?: "network")
        }
        response.use { result ->
            val text = result.body?.string().orEmpty()
            if (result.code == 401) return@withContext StateCheck.Unauthorized
            if (result.code == 403) {
                return@withContext StateCheck.Forbidden(errorName(text).ifBlank { "forbidden" })
            }
            if (!result.isSuccessful) return@withContext StateCheck.ServerError("http_${result.code}")
            val json = try {
                JSONObject(text)
            } catch (error: Exception) {
                return@withContext StateCheck.ServerError("malformed_state")
            }
            if (!json.optBoolean("ok", false)) {
                return@withContext StateCheck.ServerError(json.optString("error").ifBlank { "query_failed" })
            }
            val snapshot = json.optJSONObject("result")
                ?: return@withContext StateCheck.ServerError("missing_state")
            val pending = snapshot.optJSONObject("pendingInteraction")?.optJSONObject("request")
            val state = AgentState(
                sessionId = snapshot.optString("sessionId"),
                isStreaming = snapshot.optBoolean("isStreaming", false),
                pendingInteractionId = pending?.optString("interactionId")?.takeIf { it.isNotBlank() },
                pendingInteractionTitle = pending?.optString("title")?.takeIf { it.isNotBlank() },
                lastTurnOutcome = snapshot.optString("lastTurnOutcome").takeIf { it.isNotBlank() },
                stateVersion = snapshot.optLong("stateVersion", 0L),
            )
            StateCheck.Ok(state)
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
