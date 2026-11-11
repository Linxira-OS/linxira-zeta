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
 * The foreground WebView owns events. When the app is backgrounded this
 * service subscribes to the existing authenticated `WS /api/v1/events` with the
 * same cookie (command dispatch failures / state changes) and polls the existing
 * `session.state` query for user state. Completion comes from `isStreaming` +
 * `lastTurnOutcome`; input comes from `pendingInteraction`; neither is inferred
 * from a dispatch receipt. It sends no commands and keeps no second queue.
 */
class ConnectionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var container: AppContainer
    private var pollJob: Job? = null
    private var eventReconnectJob: Job? = null
    private var statePollJob: Job? = null
    private var stateProbeJob: Job? = null
    @Volatile private var eventStream: HostEventStream? = null
    @Volatile private var currentCredential: Credential? = null
    @Volatile private var foreground = false
    @Volatile private var stopping = false
    @Volatile private var lastState: AgentState? = null
    private val stateLock = Any()

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
                closeStatePoll()
                return START_NOT_STICKY
            }
            ACTION_BACKGROUND -> {
                foreground = false
                ensureEvents()
                ensureStatePoll()
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
            closeStatePoll()
        } else {
            ensureEvents()
            ensureStatePoll()
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
                    if (!foreground) {
                        ensureEvents()
                        ensureStatePoll()
                    }
                }
                SessionCheck.Unauthorized -> {
                    revokeFromNative()
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
                    closeStatePoll()
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

    private fun ensureStatePoll() {
        if (foreground || stopping) return
        if (statePollJob?.isActive == true) return
        statePollJob = scope.launch { stateLoop() }
    }

    private fun closeStatePoll() {
        statePollJob?.cancel()
        statePollJob = null
        stateProbeJob?.cancel()
        stateProbeJob = null
        synchronized(stateLock) { lastState = null }
    }

    private suspend fun stateLoop() {
        while (scope.isActive && !foreground && !stopping) {
            queryStateOnce()
            delay(STATE_POLL_INTERVAL_MS)
        }
    }

    private fun probeState() {
        if (foreground || stopping) return
        stateProbeJob?.cancel()
        stateProbeJob = scope.launch { queryStateOnce() }
    }

    private suspend fun queryStateOnce() {
        val credential = currentCredential ?: container.credentialStore.load() ?: return
        currentCredential = credential
        when (val check = container.sessionVerifier.queryState(credential)) {
            is StateCheck.Ok -> {
                val previous = synchronized(stateLock) {
                    lastState.also { lastState = check.state }
                }
                if (previous != null) notifyStateTransition(previous, check.state)
            }
            StateCheck.Unauthorized -> revokeFromNative()
            is StateCheck.Forbidden -> {
                // binding_scope / insufficient_scope: do not widen or clear the
                // credential; the page will show the same refusal.
            }
            is StateCheck.NetworkError, is StateCheck.ServerError -> Unit
        }
    }

    private fun notifyStateTransition(previous: AgentState, current: AgentState) {
        val credential = currentCredential ?: return
        if (current.pendingInteractionId != null &&
            current.pendingInteractionId != previous.pendingInteractionId
        ) {
            container.notifications.postAgentEvent(
                current.pendingInteractionId.hashCode().toLong(),
                getString(R.string.notification_input_needed),
                getString(
                    R.string.notification_event_body,
                    credential.host.host,
                    current.pendingInteractionTitle ?: credential.bindingDescription,
                ),
            )
        }
        val outcomeChanged = current.lastTurnOutcome != null &&
            current.lastTurnOutcome != previous.lastTurnOutcome
        if (!current.isStreaming && (previous.isStreaming || outcomeChanged)) {
            val interrupted = current.lastTurnOutcome == "interrupted"
            container.notifications.postAgentEvent(
                (current.sessionId.hashCode().toLong() shl 32) xor current.stateVersion,
                getString(if (interrupted) R.string.notification_agent_failed else R.string.notification_agent_done),
                getString(R.string.notification_event_body, credential.host.host, credential.bindingDescription),
            )
        }
    }

    private val eventListener = object : HostEventStream.Listener {
        override fun onEvent(event: HostEvent) {
            if (foreground) return
            when {
                event.kind == "state.changed" -> probeState()
                event.kind == "command.receipt" -> {
                    val command = event.commandName.orEmpty()
                    if (command !in TURN_COMMANDS) return
                    if (event.receiptStatus == "failed" ||
                        event.receiptStatus == "rejected" ||
                        event.receiptStatus == "outcome_unknown"
                    ) {
                        val credential = currentCredential ?: return
                        container.notifications.postAgentEvent(
                            event.cursor,
                            getString(R.string.notification_agent_failed),
                            getString(R.string.notification_event_body, credential.host.host, command),
                        )
                    }
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

        override fun onUnauthorized() {
            eventStream = null
            revokeFromNative()
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

    private fun revokeFromNative() {
        container.credentialStore.clear()
        container.notifications.postRevoked()
        sendBroadcast(Intent(ACTION_SESSION_REVOKED).setPackage(packageName))
        stopConnection()
    }

    private fun stopConnection() {
        stopping = true
        closeEvents()
        closeStatePoll()
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
        closeStatePoll()
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
        private const val STATE_POLL_INTERVAL_MS = 15_000L
        private const val RECONNECT_DELAY_MS = 15_000L
        private val TURN_COMMANDS = setOf("core.prompt", "core.steer", "core.followUp", "core.continue")
    }
}
