package com.zeta.android

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebStorage

object CredentialInstaller {
    fun install(context: Context, credential: Credential) {
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setCookie(credential.host.origin, credential.webViewCookie)
        cookies.flush()
    }

    fun clear(context: Context, credential: Credential?) {
        val cookies = CookieManager.getInstance()
        val origin = credential?.host?.origin
        if (origin != null) {
            cookies.setCookie(origin, "studio_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Strict")
            cookies.flush()
        }
        runCatching { WebStorage.getInstance().deleteAllData() }
    }
}
