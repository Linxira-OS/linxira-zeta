package com.zeta.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

data class PairingResult(
    val host: HostTarget,
    val sessionCookie: String,
    val csrf: String,
    val deviceId: String,
    val deviceToken: String?,
    val bindingWorkspaceId: String?,
    val bindingSessionId: String?,
    val scopes: Set<String>,
)

sealed class PairingException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class Expired : PairingException("pairing_expired")
    class RateLimited : PairingException("pairing_rate_limited")
    class TotpRequired : PairingException("pairing_totp_required")
    class Rejected(message: String) : PairingException(message)
    class Transport(cause: Throwable) : PairingException("pairing_transport", cause)
    class Malformed(cause: Throwable? = null) : PairingException("pairing_malformed", cause)
}

class PairingClient(private val client: OkHttpClient) {
    suspend fun pair(
        host: HostTarget,
        code: String,
        label: String,
        bindingWorkspaceId: String?,
        publicKeyHash: String?,
    ): PairingResult = withContext(Dispatchers.IO) {
        val device = JSONObject()
            .put("label", label)
            .put("platform", "android")
            .put("issueToken", true)
        publicKeyHash?.takeIf { it.isNotBlank() }?.let { device.put("publicKeyHash", it) }
        bindingWorkspaceId?.trim()?.takeIf { it.isNotEmpty() }?.let {
            device.put("binding", JSONObject().put("workspaceId", it))
        }
        val body = JSONObject()
            .put("code", code)
            .put("device", device)
            .toString()
            .toRequestBody(JSON_MEDIA)
        val request = Request.Builder()
            .url(host.apiUrl("/api/v1/pair"))
            .post(body)
            .header("Accept", "application/json")
            .header("X-Zeta-Client", "android-native")
            .build()

        val response = try {
            client.newCall(request).execute()
        } catch (error: Exception) {
            throw PairingException.Transport(error)
        }
        response.use { result ->
            val text = result.body?.string().orEmpty()
            if (!result.isSuccessful) {
                when (result.code) {
                    401 -> throw PairingException.Expired()
                    403 -> {
                        if (errorName(text) == "totp_required") throw PairingException.TotpRequired()
                        throw PairingException.Rejected(errorName(text).ifBlank { "pairing_forbidden" })
                    }
                    429 -> throw PairingException.RateLimited()
                    else -> throw PairingException.Rejected(errorName(text).ifBlank { "http_${result.code}" })
                }
            }
            val cookie = sessionCookie(result.headers.values("Set-Cookie"))
                ?: throw PairingException.Malformed()
            val json = try {
                JSONObject(text)
            } catch (error: Exception) {
                throw PairingException.Malformed(error)
            }
            val csrf = json.optString("csrf")
            if (csrf.isBlank()) throw PairingException.Malformed()
            val deviceJson = json.optJSONObject("device") ?: throw PairingException.Malformed()
            val deviceId = deviceJson.optString("id")
            if (deviceId.isBlank()) throw PairingException.Malformed()
            val binding = deviceJson.optJSONObject("binding")
            val scopesJson = deviceJson.optJSONArray("scopes") ?: JSONArray()
            val scopes = buildSet {
                for (index in 0 until scopesJson.length()) {
                    val value = scopesJson.optString(index)
                    if (value.isNotBlank()) add(value)
                }
            }
            PairingResult(
                host = host,
                sessionCookie = cookie,
                csrf = csrf,
                deviceId = deviceId,
                deviceToken = deviceJson.optString("token").takeIf { it.isNotBlank() },
                bindingWorkspaceId = binding?.optString("workspaceId")?.takeIf { it.isNotBlank() },
                bindingSessionId = binding?.optString("sessionId")?.takeIf { it.isNotBlank() },
                scopes = scopes,
            )
        }
    }

    private fun errorName(body: String): String {
        return try {
            JSONObject(body).optString("error")
        } catch (_: Exception) {
            ""
        }
    }

    private fun sessionCookie(setCookies: List<String>): String? {
        val pattern = Regex("(?:^|;)\\s*studio_session=([^;]+)", RegexOption.IGNORE_CASE)
        for (header in setCookies) {
            val value = pattern.find(header)?.groupValues?.getOrNull(1)?.trim()
            if (!value.isNullOrEmpty()) return value
        }
        return null
    }

    private companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
