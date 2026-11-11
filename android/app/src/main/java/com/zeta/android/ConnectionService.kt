package com.zeta.android

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.annotation.RequiresApi
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

/**
 * Foreground host state plus the background notification subscriber.
 *
 * While the WebView is foreground it owns the event stream; this service only
 * verifies the session. When the app goes background, the service subscribes to
 * the existing authenticated `WS /api/v1/events` surface with the same
 * device-bound cookie/token and surfaces agent completion and input prompts. It
 * sends no commands and keeps no second queue.
 */
class ConnectionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var container: AppContainer
    private var pollJob: Job? = null
    private var eventReconnectJob: Job? = null
    @Volatile private var eventStream: HostEventStream? = null
    @Volatile private var currentCredential: Credential? = null
    @Volatile private var foreground = false
    @Volatile private var stopping = false

    private val eventClient by lazy {
        container.httpClient.newBuilder().pingInterval(20, TimeUnit.SECONDS).build()
    }

    override fun onCreate() {
        super.onCreate()
        container = zetaContainer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopConnection()
                return START_NOT_STICKY
            }
            ACTION_FOREGROUND -> {
                foreground = true
                closeEvents()
                return START_NOT_STICKY
            }
            ACTION_BACKGROUND -> {
                foreground = false
                ensureEvents()
                return START_NOT_STICKY
            }
        }

        val credential = container.credentialStore.load() ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        currentCredential = credential
        foreground = intent?.getBooleanExtra(EXTRA_FOREGROUND, foreground) ?: foreground
        startConnectionForeground(credential, reconnecting = false, verification = false)
        if (pollJob?.isActive != true) {
            pollJob = scope.launch { poll(credential) }
        }
        if (foreground) {
            closeEvents()
        } else {
            ensureEvents()
        }
        return START_NOT_STICKY
    }

    private suspend fun poll(initial: Credential) {
        var credential = initial
        var reconnecting = false
        while (scope.isActive && !stopping) {
            when (val check = container.sessionVerifier.verify(credential)) {
                is SessionCheck.Valid -> {
                    reconnecting = false
                    credential = container.credentialStore.current ?: credential
                    currentCredential = credential
                    container.notifications.postConnection(
                        container.notifications.connectionNotification(
                            credential.host.host,
                            reconnecting = false,
                            verification = false,
                        ),
                    )
                    if (!foreground) ensureEvents()
                }
                SessionCheck.Unauthorized -> {
                    container.credentialStore.clear()
                    container.notifications.postRevoked()
                    sendBroadcast(Intent(ACTION_SESSION_REVOKED).setPackage(packageName))
                    stopConnection()
                    return
                }
                SessionCheck.TotpRequired -> {
                    container.notifications.postConnection(
                        container.notifications.connectionNotification(
                            credential.host.host,
                            reconnecting = false,
                            verification = true,
                        ),
                    )
                }
                is SessionCheck.NetworkError, is SessionCheck.ServerError -> {
                    reconnecting = true
                    container.notifications.postConnection(
                        container.notifications.connectionNotification(
                            credential.host.host,
                            reconnecting = true,
                            verification = false,
                        ),
                    )
                    closeEvents()
                }
            }
            delay(POLL_INTERVAL_MS)
        }
    }

    private fun ensureEvents() {
        if (foreground || stopping) return
        if (eventStream != null) return
        val credential = currentCredential ?: container.credentialStore.load() ?: return
        currentCredential = credential
        val stream = HostEventStream(eventClient, credential, eventListener)
        eventStream = stream
        stream.connect()
    }

    private val eventListener = object : HostEventStream.Listener {
        override fun onEvent(event: HostEvent) {
            if (foreground) return
            val credential = currentCredential ?: return
            when {
                event.kind == "interaction.required" -> {
                    val title = event.interactionTitle ?: credential.bindingDescription
                    container.notifications.postAgentEvent(
                        event.cursor,
                        getString(R.string.notification_input_needed),
                        getString(R.string.notification_event_body, credential.host.host, title),
                    )
                }
                event.kind == "command.receipt" -> {
                    val command = event.commandName.orEmpty()
                    if (command !in TURN_COMMANDS) return
                    when (event.receiptStatus) {
                        "completed" -> container.notifications.postAgentEvent(
                            event.cursor,
                            getString(R.string.notification_agent_done),
                            getString(R.string.notification_event_body, credential.host.host, credential.bindingDescription),
                        )
                        "failed", "rejected", "outcome_unknown" -> container.notifications.postAgentEvent(
                            event.cursor,
                            getString(R.string.notification_agent_failed),
                            getString(R.string.notification_event_body, credential.host.host, command),
                        )
                    }
                }
                event.kind == "conversation.changed" &&
                    event.conversationKind == "conversation.turn.aborted" -> {
                    container.notifications.postAgentEvent(
                        event.cursor,
                        getString(R.string.notification_agent_failed),
                        getString(R.string.notification_event_body, credential.host.host, credential.bindingDescription),
                    )
                }
            }
        }

        override fun onClosed(reason: String) {
            eventStream = null
            if (foreground || stopping) return
            eventReconnectJob?.cancel()
            eventReconnectJob = scope.launch {
                delay(RECONNECT_DELAY_MS)
                if (!foreground && !stopping) ensureEvents()
            }
        }
    }

    private fun startConnectionForeground(credential: Credential, reconnecting: Boolean, verification: Boolean) {
        ServiceCompat.startForeground(
            this,
            NotificationController.NOTIFICATION_CONNECTION,
            container.notifications.connectionNotification(credential.host.host, reconnecting, verification),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
    }

    private fun closeEvents() {
        eventReconnectJob?.cancel()
        eventReconnectJob = null
        eventStream?.close()
        eventStream = null
    }

    private fun stopConnection() {
        stopping = true
        closeEvents()
        pollJob?.cancel()
        pollJob = null
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    @RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)
    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15 limits dataSync foreground services. Stop honestly and
        // leave a paused notification instead of pretending to stay connected
        // forever.
        container.notifications.postPaused()
        stopConnection()
    }

    override fun onDestroy() {
        stopping = true
        closeEvents()
        pollJob?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.zeta.android.action.CONNECT"
        const val ACTION_STOP = "com.zeta.android.action.DISCONNECT"
        const val ACTION_FOREGROUND = "com.zeta.android.action.FOREGROUND"
        const val ACTION_BACKGROUND = "com.zeta.android.action.BACKGROUND"
        const val ACTION_SESSION_REVOKED = "com.zeta.android.action.SESSION_REVOKED"
        const val EXTRA_FOREGROUND = "foreground"
        private const val POLL_INTERVAL_MS = 60_000L
        private const val RECONNECT_DELAY_MS = 15_000L
        private val TURN_COMMANDS = setOf("core.prompt", "core.steer", "core.followUp", "core.continue")
    }
}
