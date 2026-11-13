package com.zeta.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureCredentialStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @Volatile
    var current: Credential? = null
        private set

    fun load(): Credential? {
        val stored = prefs.getString(KEY_PAYLOAD, null) ?: return null
        val credential = try {
            val envelope = JSONObject(stored)
            val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
            val ciphertext = Base64.decode(envelope.getString("ct"), Base64.NO_WRAP)
            val plain = decrypt(iv, ciphertext)
            parse(JSONObject(String(plain, Charsets.UTF_8)))
        } catch (_: Exception) {
            // A damaged blob is not a credential. Drop it so the user can pair
            // again instead of keeping a half-readable secret.
            prefs.edit().remove(KEY_PAYLOAD).commit()
            null
        }
        current = credential
        return credential
    }

    fun save(credential: Credential) {
        val plain = encode(credential).toString().toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, aesKey())
        val ciphertext = cipher.doFinal(plain)
        val envelope = JSONObject()
            .put("v", 1)
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ct", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .toString()
        if (!prefs.edit().putString(KEY_PAYLOAD, envelope).commit()) {
            throw IllegalStateException("could not persist the device credential")
        }
        current = credential
    }

    fun clear() {
        current = null
        prefs.edit().remove(KEY_PAYLOAD).commit()
        runCatching { keyStore().deleteEntry(AES_ALIAS) }
        runCatching { keyStore().deleteEntry(EC_ALIAS) }
    }

    /** Public key hash for the device identity. The private key stays in Keystore. */
    fun devicePublicKeyHash(): String {
        val keyPair = deviceKeyPair()
        val digest = MessageDigest.getInstance("SHA-256").digest(keyPair.public.encoded)
        return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    private fun parse(json: JSONObject): Credential? {
        val origin = json.optString("origin")
        val baseUrl = json.optString("baseUrl")
        val host = HostPolicy.parse(baseUrl) ?: return null
        if (host.origin != origin) return null
        val cookie = json.optString("cookie")
        if (cookie.isBlank()) return null
        val bindingWorkspaceId = json.optString("bindingWorkspaceId").takeIf { it.isNotBlank() } ?: return null
        val scopesJson = json.optJSONArray("scopes") ?: JSONArray()
        val scopes = buildSet {
            for (index in 0 until scopesJson.length()) {
                val value = scopesJson.optString(index)
                if (value.isNotBlank()) add(value)
            }
        }
        return Credential(
            host = host,
            sessionCookie = cookie,
            csrf = json.optString("csrf"),
            deviceId = json.optString("deviceId"),
            deviceToken = json.optString("deviceToken").takeIf { it.isNotBlank() },
            bindingWorkspaceId = bindingWorkspaceId,
            bindingSessionId = json.optString("bindingSessionId").takeIf { it.isNotBlank() },
            scopes = scopes,
            createdAt = json.optLong("createdAt", 0L),
        )
    }

    private fun encode(credential: Credential): JSONObject {
        val scopes = JSONArray()
        credential.scopes.sorted().forEach(scopes::put)
        return JSONObject()
            .put("origin", credential.host.origin)
            .put("baseUrl", credential.host.baseUrl)
            .put("cookie", credential.sessionCookie)
            .put("csrf", credential.csrf)
            .put("deviceId", credential.deviceId)
            .put("deviceToken", credential.deviceToken ?: "")
            .put("bindingWorkspaceId", credential.bindingWorkspaceId)
            .put("bindingSessionId", credential.bindingSessionId ?: "")
            .put("scopes", scopes)
            .put("createdAt", credential.createdAt)
    }

    private fun decrypt(iv: ByteArray, ciphertext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, aesKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext)
    }

    private fun aesKey(): SecretKey {
        val store = keyStore()
        (store.getEntry(AES_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                AES_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private fun deviceKeyPair(): KeyPair {
        val store = keyStore()
        val existing = store.getEntry(EC_ALIAS, null) as? KeyStore.PrivateKeyEntry
        if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        generator.initialize(
            KeyGenParameterSpec.Builder(
                EC_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKeyPair()
    }

    private fun keyStore(): KeyStore {
        return KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    }

    private companion object {
        const val PREFS_NAME = "zeta_android_credentials"
        const val KEY_PAYLOAD = "credential_v1"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val AES_ALIAS = "zeta.android.credential.v1"
        const val EC_ALIAS = "zeta.android.device.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
