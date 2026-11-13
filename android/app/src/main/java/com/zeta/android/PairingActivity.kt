package com.zeta.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PairingActivity : AppCompatActivity() {
    private lateinit var container: AppContainer
    private lateinit var hostField: EditText
    private lateinit var codeField: EditText
    private lateinit var bindingField: EditText
    private lateinit var status: TextView
    private lateinit var pairButton: Button
    private lateinit var scanButton: Button

    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        val contents = result.contents
        if (contents.isNullOrBlank()) {
            status.text = getString(R.string.pair_invalid_payload)
            return@registerForActivityResult
        }
        try {
            val payload = PairingPayloadParser.parse(contents)
            hostField.setText(payload.host.baseUrl)
            codeField.setText(payload.code)
            status.text = ""
        } catch (error: PairingPayloadException.Legacy) {
            status.text = getString(R.string.pair_legacy_payload)
        } catch (_: PairingPayloadException.Invalid) {
            status.text = getString(R.string.pair_invalid_payload)
        }
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startScan()
        } else {
            status.text = getString(R.string.pair_camera_denied)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        container = zetaContainer()
        setContentView(buildContent())

        val lastHost = getSharedPreferences(UI_PREFS, MODE_PRIVATE).getString(KEY_LAST_HOST, null)
        hostField.setText(lastHost ?: "https://")
        hostField.setSelection(hostField.text.length)

        scanButton.setOnClickListener {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                startScan()
            } else {
                cameraPermission.launch(Manifest.permission.CAMERA)
            }
        }
        pairButton.setOnClickListener { startPairing() }
    }

    private fun buildContent(): ScrollView {
        val scroll = ScrollView(this).apply { isFillViewport = true }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
            setBackgroundColor(color(R.color.zeta_background))
        }
        scroll.addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val title = TextView(this).apply {
            text = getString(R.string.pair_title)
            textSize = 22f
            setTextColor(color(R.color.zeta_text))
        }
        root.addView(title, matchWrap(top = 0))

        val intro = TextView(this).apply {
            text = getString(R.string.pair_intro)
            textSize = 13f
            setTextColor(color(R.color.zeta_muted))
        }
        root.addView(intro, matchWrap(top = 8))

        hostField = EditText(this).apply {
            hint = getString(R.string.pair_host_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
            setTextColor(color(R.color.zeta_text))
        }
        root.addView(hostField, matchWrap(top = 22))

        codeField = EditText(this).apply {
            hint = getString(R.string.pair_code_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setSingleLine(true)
            setTextColor(color(R.color.zeta_text))
        }
        root.addView(codeField, matchWrap(top = 12))

        bindingField = EditText(this).apply {
            hint = getString(R.string.pair_binding_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setSingleLine(true)
            setTextColor(color(R.color.zeta_text))
        }
        root.addView(bindingField, matchWrap(top = 12))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        scanButton = Button(this).apply { text = getString(R.string.pair_scan) }
        pairButton = Button(this).apply {
            text = getString(R.string.pair_submit)
            setTextColor(color(R.color.zeta_background))
            setBackgroundColor(color(R.color.zeta_primary))
        }
        actions.addView(scanButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        actions.addView(pairButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(12)
        })
        root.addView(actions, matchWrap(top = 22))

        status = TextView(this).apply {
            textSize = 13f
            setTextColor(color(R.color.zeta_accent))
        }
        root.addView(status, matchWrap(top = 18))
        return scroll
    }

    private fun startScan() {
        val options = ScanOptions().apply {
            setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            setPrompt(getString(R.string.pair_scan))
            setBeepEnabled(false)
            setOrientationLocked(false)
            setBarcodeImageEnabled(false)
        }
        scanLauncher.launch(options)
    }

    private fun startPairing() {
        status.text = ""
        val host = HostPolicy.parse(HostPolicy.normalizeInput(hostField.text.toString()))
        if (host == null) {
            status.text = getString(R.string.pair_invalid_host)
            return
        }
        val code = codeField.text.toString().trim()
        if (code.isEmpty()) {
            status.text = getString(R.string.pair_invalid_code)
            return
        }
        val requestedBinding = bindingField.text.toString().trim().takeIf { it.isNotEmpty() }
        if (requestedBinding == null) {
            status.text = getString(R.string.pair_binding_required)
            return
        }
        setBusy(true)
        lifecycleScope.launch {
            val publicKeyHash = withContext(Dispatchers.IO) {
                runCatching { container.credentialStore.devicePublicKeyHash() }.getOrNull()
            }
            val result = try {
                container.pairingClient.pair(
                    host = host,
                    code = code,
                    label = android.os.Build.MODEL,
                    bindingWorkspaceId = requestedBinding,
                    publicKeyHash = publicKeyHash,
                )
            } catch (error: PairingException) {
                setBusy(false)
                status.text = pairingError(error)
                return@launch
            }
            val confirmedBinding = result.bindingWorkspaceId
            if (confirmedBinding == null || confirmedBinding != requestedBinding) {
                setBusy(false)
                status.text = getString(R.string.pair_binding_unconfirmed)
                return@launch
            }
            val issuedToken = result.deviceToken
            if (issuedToken == null) {
                setBusy(false)
                status.text = getString(R.string.pair_token_missing)
                return@launch
            }
            val credential = Credential(
                host = result.host,
                sessionCookie = result.sessionCookie,
                csrf = result.csrf,
                deviceId = result.deviceId,
                deviceToken = issuedToken,
                bindingWorkspaceId = confirmedBinding,
                bindingSessionId = result.bindingSessionId,
                scopes = result.scopes,
                createdAt = System.currentTimeMillis(),
            )
            try {
                withContext(Dispatchers.IO) { container.credentialStore.save(credential) }
                CredentialInstaller.install(this@PairingActivity, credential)
            } catch (_: Exception) {
                setBusy(false)
                status.text = getString(R.string.pair_failed)
                return@launch
            }
            getSharedPreferences(UI_PREFS, MODE_PRIVATE).edit()
                .putString(KEY_LAST_HOST, result.host.baseUrl)
                .apply()
            startActivity(Intent(this@PairingActivity, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            })
            setResult(RESULT_OK)
            finish()
        }
    }

    private fun pairingError(error: PairingException): String {
        return when (error) {
            is PairingException.Expired -> getString(R.string.pair_expired)
            is PairingException.RateLimited -> getString(R.string.pair_rate_limited)
            is PairingException.TotpRequired -> getString(R.string.notification_verification)
            is PairingException.Transport -> getString(R.string.pair_network)
            is PairingException.Rejected -> if (error.message == "binding_invalid") {
                getString(R.string.pair_binding_invalid)
            } else {
                getString(R.string.pair_failed)
            }
            is PairingException.Malformed -> getString(R.string.pair_failed)
        }
    }

    private fun setBusy(busy: Boolean) {
        pairButton.isEnabled = !busy
        scanButton.isEnabled = !busy
        hostField.isEnabled = !busy
        codeField.isEnabled = !busy
        bindingField.isEnabled = !busy
        pairButton.text = getString(if (busy) R.string.pair_pairing else R.string.pair_submit)
    }

    private fun matchWrap(top: Int = 0): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(top)
        }
    }

    private companion object {
        const val UI_PREFS = "zeta_android_ui"
        const val KEY_LAST_HOST = "last_host"
    }
}
