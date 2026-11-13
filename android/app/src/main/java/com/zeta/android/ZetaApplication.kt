package com.zeta.android

import android.app.Application
import android.content.Context
import okhttp3.OkHttpClient

class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val httpClient: OkHttpClient = HttpClientFactory.create()
    val credentialStore = SecureCredentialStore(appContext)
    val pairingClient = PairingClient(httpClient)
    val sessionVerifier = SessionVerifier(httpClient, credentialStore)
    val notifications = NotificationController(appContext)
}

class ZetaApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

fun Context.zetaContainer(): AppContainer = (applicationContext as ZetaApplication).container
