package com.zeta.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

class NotificationController(private val context: Context) {
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        val channel = NotificationChannel(
            CHANNEL_CONNECTION,
            context.getString(R.string.notification_channel_connection),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = context.getString(R.string.notification_channel_connection)
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
        val events = NotificationChannel(
            CHANNEL_EVENTS,
            context.getString(R.string.notification_channel_events),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_events)
            setShowBadge(true)
        }
        manager.createNotificationChannel(events)
    }

    fun postAgentEvent(id: Long, title: String, body: String) {
        val notification = NotificationCompat.Builder(context, CHANNEL_EVENTS)
            .setSmallIcon(R.drawable.ic_stat_zeta)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(openIntent())
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .build()
        val notificationId = NOTIFICATION_EVENT_BASE + (id and 0x0FFFFFFFL).toInt()
        manager.notify(notificationId, notification)
    }

    fun connectionNotification(host: String, reconnecting: Boolean, verification: Boolean): Notification {
        val text = when {
            verification -> context.getString(R.string.notification_verification)
            reconnecting -> context.getString(R.string.notification_reconnecting, host)
            else -> context.getString(R.string.notification_connected, host)
        }
        return NotificationCompat.Builder(context, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_stat_zeta)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(openIntent())
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .addAction(
                0,
                context.getString(R.string.notification_disconnect),
                stopIntent(),
            )
            .build()
    }

    fun revokedNotification(): Notification {
        return NotificationCompat.Builder(context, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_stat_zeta)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.notification_revoked))
            .setContentIntent(openIntent())
            .setAutoCancel(true)
            .build()
    }

    fun pausedNotification(): Notification {
        return NotificationCompat.Builder(context, CHANNEL_CONNECTION)
            .setSmallIcon(R.drawable.ic_stat_zeta)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.notification_paused))
            .setContentIntent(openIntent())
            .setAutoCancel(true)
            .build()
    }

    fun postRevoked() {
        manager.notify(NOTIFICATION_REVOKED, revokedNotification())
    }

    fun postPaused() {
        manager.notify(NOTIFICATION_PAUSED, pausedNotification())
    }

    fun postConnection(notification: Notification) {
        manager.notify(NOTIFICATION_CONNECTION, notification)
    }

    private fun openIntent(): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            REQUEST_OPEN,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun stopIntent(): PendingIntent {
        val intent = Intent(context, ConnectionService::class.java).setAction(ConnectionService.ACTION_STOP)
        return PendingIntent.getService(
            context,
            REQUEST_STOP,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val CHANNEL_CONNECTION = "zeta_host_connection"
        const val CHANNEL_EVENTS = "zeta_host_events"
        const val NOTIFICATION_CONNECTION = 4101
        const val NOTIFICATION_REVOKED = 4102
        const val NOTIFICATION_PAUSED = 4103
        const val NOTIFICATION_EVENT_BASE = 4200
        private const val REQUEST_OPEN = 5101
        private const val REQUEST_STOP = 5102
    }
}
