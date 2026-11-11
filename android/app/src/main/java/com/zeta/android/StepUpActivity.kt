package com.zeta.android

import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class StepUpActivity : AppCompatActivity() {
    private lateinit var container: AppContainer
    private lateinit var codeField: EditText
    private lateinit var status: TextView
    private lateinit var verifyButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        container = zetaContainer()
        setContentView(buildContent())
        verifyButton.setOnClickListener { verify() }
    }

    private fun buildContent(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
            setBackgroundColor(color(R.color.zeta_background))
        }
        val title = TextView(this).apply {
            text = getString(R.string.verify_title)
            textSize = 20f
            setTextColor(color(R.color.zeta_text))
        }
        root.addView(title, wrap())
        val hint = TextView(this).apply {
            text = getString(R.string.verify_hint)
            textSize = 13f
            setTextColor(color(R.color.zeta_muted))
        }
        root.addView(hint, wrap(top = 8))
        codeField = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            setSingleLine(true)
            setTextColor(color(R.color.zeta_text))
        }
        root.addView(codeField, wrap(top = 20))
        verifyButton = Button(this).apply { text = getString(R.string.verify_submit) }
        root.addView(verifyButton, wrap(top = 16))
        status = TextView(this).apply {
            textSize = 13f
            setTextColor(color(R.color.zeta_accent))
        }
        root.addView(status, wrap(top = 16))
        return root
    }

    private fun verify() {
        val code = codeField.text.toString().trim()
        if (code.isEmpty()) {
            status.text = getString(R.string.verify_failed)
            return
        }
        verifyButton.isEnabled = false
        status.text = ""
        lifecycleScope.launch {
            val credential = withContext(Dispatchers.IO) { container.credentialStore.load() }
            if (credential == null) {
                finish()
                return@launch
            }
            when (container.sessionVerifier.verifyTotp(credential, code)) {
                TotpResult.Ok -> {
                    toast(getString(R.string.verify_done))
                    setResult(RESULT_OK)
                    finish()
                }
                TotpResult.Invalid -> {
                    verifyButton.isEnabled = true
                    status.text = getString(R.string.verify_failed)
                }
                TotpResult.RateLimited -> {
                    verifyButton.isEnabled = true
                    status.text = getString(R.string.pair_rate_limited)
                }
                is TotpResult.NetworkError -> {
                    verifyButton.isEnabled = true
                    status.text = getString(R.string.verify_network)
                }
                is TotpResult.ServerError -> {
                    verifyButton.isEnabled = true
                    status.text = getString(R.string.verify_failed)
                }
            }
        }
    }

    private fun wrap(top: Int = 0): LinearLayout.LayoutParams {
        return LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(top)
        }
    }
}
