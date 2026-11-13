package com.zeta.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.PopupMenu
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var container: AppContainer
    private lateinit var titleView: TextView
    private lateinit var overflow: TextView
    private lateinit var progress: ProgressBar
    private lateinit var errorPanel: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var retryButton: Button
    private lateinit var pairButton: Button
    private lateinit var content: FrameLayout

    private var webView: WebView? = null
    private var credential: Credential? = null
    private var sessionJob: Job? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var connectionServiceStarted = false

    private val sessionEvents = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ConnectionService.ACTION_SESSION_REVOKED) {
                expireSession(getString(R.string.session_revoked))
            }
        }
    }

    private val pairLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            reloadSession()
        } else if (credential == null) {
            showError(getString(R.string.session_expired), canRetry = false, canPair = true)
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startConnectionService()
        } else {
            toast(getString(R.string.notification_permission_denied))
        }
    }

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback
        fileCallback = null
        callback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        container = zetaContainer()
        setContentView(buildRoot())
        ContextCompat.registerReceiver(
            this,
            sessionEvents,
            IntentFilter(ConnectionService.ACTION_SESSION_REVOKED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val web = webView
                if (web != null && web.canGoBack()) {
                    web.goBack()
                } else {
                    finish()
                }
            }
        })
        overflow.setOnClickListener { showMenu() }
        retryButton.setOnClickListener { reloadSession() }
        pairButton.setOnClickListener { startPairing() }
        reloadSession()
    }

    private fun buildRoot(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(color(R.color.zeta_background))
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(16), 0, dp(8), 0)
            setBackgroundColor(color(R.color.zeta_surface))
        }
        titleView = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 15f
            setTextColor(color(R.color.zeta_text))
        }
        overflow = TextView(this).apply {
            text = "⋮"
            textSize = 22f
            gravity = android.view.Gravity.CENTER
            setTextColor(color(R.color.zeta_text))
            setPadding(dp(12), 0, dp(12), 0)
        }
        bar.addView(titleView, LinearLayout.LayoutParams(0, dp(48), 1f))
        bar.addView(overflow, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))

        content = FrameLayout(this)
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        progress = ProgressBar(this).apply {
            visibility = View.GONE
        }
        content.addView(progress, FrameLayout.LayoutParams(dp(40), dp(40), android.view.Gravity.CENTER))

        errorPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(dp(28), dp(28), dp(28), dp(28))
            visibility = View.GONE
        }
        errorText = TextView(this).apply {
            textSize = 15f
            setTextColor(color(R.color.zeta_text))
            gravity = android.view.Gravity.CENTER
        }
        retryButton = Button(this).apply { text = getString(R.string.session_retry) }
        pairButton = Button(this).apply { text = getString(R.string.session_pair) }
        errorPanel.addView(errorText, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ))
        errorPanel.addView(retryButton, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(18) })
        errorPanel.addView(pairButton, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(8) })
        content.addView(errorPanel, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))
        return root
    }

    private fun reloadSession() {
        sessionJob?.cancel()
        showLoading()
        sessionJob = lifecycleScope.launch {
            val loaded = withContext(Dispatchers.IO) { container.credentialStore.load() }
            if (loaded == null) {
                credential = null
                showError(getString(R.string.session_pair), canRetry = false, canPair = true)
                return@launch
            }
            credential = loaded
            CredentialInstaller.install(this@MainActivity, loaded)
            when (val check = withContext(Dispatchers.IO) { container.sessionVerifier.verify(loaded) }) {
                is SessionCheck.Valid -> {
                    val fresh = container.credentialStore.current ?: loaded
                    credential = fresh
                    showWeb(fresh)
                    ensureNotificationPermission()
                }
                SessionCheck.Unauthorized -> expireSession(getString(R.string.session_revoked))
                SessionCheck.TotpRequired -> showError(
                    getString(R.string.notification_verification),
                    canRetry = false,
                    canPair = false,
                )
                is SessionCheck.NetworkError -> showError(
                    getString(R.string.session_network_error),
                    canRetry = true,
                    canPair = true,
                )
                is SessionCheck.ServerError -> showError(
                    getString(R.string.session_web_error),
                    canRetry = true,
                    canPair = true,
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(fresh: Credential) {
        errorPanel.visibility = View.GONE
        progress.visibility = View.GONE
        val existing = webView
        if (existing != null && credential?.host?.origin == fresh.host.origin) {
            existing.visibility = View.VISIBLE
            existing.reload()
        } else {
            existing?.let {
                it.destroy()
            }
            webView = createWebView(fresh).also { content.addView(it, 0, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )) }
        }
        credential = fresh
        titleView.text = buildString {
            append(getString(R.string.app_name))
            append(" · ")
            append(fresh.bindingDescription)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(fresh: Credential): WebView {
        val web = WebView(this)
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(web, false)
        cookies.setCookie(fresh.host.origin, fresh.webViewCookie)
        cookies.flush()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            setGeolocationEnabled(false)
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            safeBrowsingEnabled = true
            builtInZoomControls = false
            displayZoomControls = false
        }
        WebView.setWebContentsDebuggingEnabled(isDebuggable())
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val webRequest = request ?: return false
                val target = webRequest.url.toString()
                if (!webRequest.isForMainFrame) return true
                if (fresh.host.isSameOrigin(target)) return false
                if (HostPolicy.isSafeExternal(target)) {
                    confirmExternal(target)
                } else {
                    toast(getString(R.string.session_blocked_navigation))
                }
                return true
            }

            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: android.net.http.SslError?) {
                handler?.cancel()
                progress.visibility = View.GONE
                showError(getString(R.string.session_tls_error), canRetry = true, canPair = false)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    progress.visibility = View.GONE
                    showError(getString(R.string.session_web_error), canRetry = true, canPair = false)
                }
            }

            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: android.webkit.WebResourceResponse?) {
                if (request?.isForMainFrame == true && errorResponse?.statusCode == 401) {
                    expireSession(getString(R.string.session_revoked))
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progress.visibility = View.GONE
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progress.visibility = if (newProgress in 0..99) View.VISIBLE else View.GONE
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                if (fileCallback != null) {
                    filePathCallback?.onReceiveValue(null)
                    return true
                }
                val params = fileChooserParams ?: run {
                    filePathCallback?.onReceiveValue(null)
                    return true
                }
                fileCallback = filePathCallback
                return try {
                    fileChooser.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.deny()
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?,
            ) {
                callback?.invoke(origin, false, false)
            }
        }
        web.loadUrl(fresh.host.baseUrl)
        return web
    }

    private fun confirmExternal(url: String) {
        AlertDialog.Builder(this)
            .setTitle(R.string.session_external_title)
            .setMessage(R.string.session_external_message)
            .setNegativeButton(R.string.session_cancel, null)
            .setPositiveButton(R.string.session_open) { _, _ ->
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (_: ActivityNotFoundException) {
                    toast(getString(R.string.session_blocked_navigation))
                }
            }
            .show()
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            startConnectionService()
        }
    }

    private fun startConnectionService() {
        val fresh = credential ?: return
        if (fresh.sessionCookie.isBlank()) return
        val intent = Intent(this, ConnectionService::class.java)
            .setAction(ConnectionService.ACTION_START)
            .putExtra(ConnectionService.EXTRA_FOREGROUND, true)
        ContextCompat.startForegroundService(this, intent)
        connectionServiceStarted = true
    }

    private fun stopConnectionService() {
        connectionServiceStarted = false
        stopService(Intent(this, ConnectionService::class.java))
    }

    private fun signalHostForeground(foreground: Boolean) {
        if (!connectionServiceStarted) return
        val action = if (foreground) {
            ConnectionService.ACTION_FOREGROUND
        } else {
            ConnectionService.ACTION_BACKGROUND
        }
        runCatching {
            startService(Intent(this, ConnectionService::class.java).setAction(action))
        }
    }

    private fun showMenu() {
        val menu = PopupMenu(this, overflow)
        menu.menu.add(0, MENU_VERIFY, 0, getString(R.string.session_verify_2fa))
        menu.menu.add(0, MENU_DISCONNECT, 1, getString(R.string.session_disconnect))
        menu.menu.add(0, MENU_PAIR_ANOTHER, 2, getString(R.string.session_pair_another))
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MENU_VERIFY -> {
                    startActivity(Intent(this, StepUpActivity::class.java))
                    true
                }
                MENU_DISCONNECT -> {
                    confirmDisconnect()
                    true
                }
                MENU_PAIR_ANOTHER -> {
                    confirmPairAnother()
                    true
                }
                else -> false
            }
        }
        menu.show()
    }

    private fun confirmDisconnect() {
        AlertDialog.Builder(this)
            .setMessage(R.string.session_disconnect_confirm)
            .setNegativeButton(R.string.session_cancel, null)
            .setPositiveButton(R.string.session_disconnect) { _, _ -> disconnect() }
            .show()
    }

    private fun confirmPairAnother() {
        AlertDialog.Builder(this)
            .setMessage(R.string.session_pair_another_confirm)
            .setNegativeButton(R.string.session_cancel, null)
            .setPositiveButton(R.string.session_pair_another) { _, _ ->
                clearLocalCredential()
                startPairing()
            }
            .show()
    }

    private fun disconnect() {
        val current = credential
        clearLocalCredential()
        if (current != null) {
            lifecycleScope.launch(Dispatchers.IO) {
                runCatching { container.sessionVerifier.revokeSession(current) }
            }
        }
        showError(getString(R.string.session_expired), canRetry = false, canPair = true)
    }

    private fun expireSession(message: String) {
        clearLocalCredential()
        showError(message, canRetry = false, canPair = true)
    }

    private fun clearLocalCredential() {
        val current = credential
        credential = null
        webView?.let {
            it.destroy()
        }
        webView = null
        stopConnectionService()
        CredentialInstaller.clear(this, current)
        lifecycleScope.launch(Dispatchers.IO) { container.credentialStore.clear() }
        titleView.text = getString(R.string.app_name)
    }

    private fun startPairing() {
        pairLauncher.launch(Intent(this, PairingActivity::class.java))
    }

    private fun showLoading() {
        progress.visibility = View.VISIBLE
        errorPanel.visibility = View.GONE
    }

    private fun showError(message: String, canRetry: Boolean, canPair: Boolean) {
        progress.visibility = View.GONE
        errorText.text = message
        retryButton.visibility = if (canRetry) View.VISIBLE else View.GONE
        pairButton.visibility = if (canPair) View.VISIBLE else View.GONE
        errorPanel.visibility = View.VISIBLE
        webView?.visibility = View.GONE
    }

    private fun isDebuggable(): Boolean {
        return applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
    }

    override fun onStart() {
        super.onStart()
        signalHostForeground(true)
    }

    override fun onStop() {
        if (!isFinishing) signalHostForeground(false)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        sessionJob?.cancel()
        runCatching { unregisterReceiver(sessionEvents) }
        webView?.let {
            it.destroy()
        }
        webView = null
        if (isFinishing) stopConnectionService()
        super.onDestroy()
    }

    private companion object {
        const val MENU_VERIFY = 1
        const val MENU_DISCONNECT = 2
        const val MENU_PAIR_ANOTHER = 3
    }
}
