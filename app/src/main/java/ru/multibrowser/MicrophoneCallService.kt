package ru.multibrowser

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/** Protects an ongoing microphone call when Android puts the browser in the background. */
class MicrophoneCallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            BackgroundCalls.endCall(this, intent.getStringExtra(TOKEN))
            if (BackgroundCalls.calls.isEmpty) stopSelf()
            return START_NOT_STICKY
        }
        if (BackgroundCalls.calls.isEmpty || !BackgroundCalls.permitted(this)) {
            BackgroundCalls.endAll(this, stopService = false)
            stopSelf()
            return START_NOT_STICKY
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, Tr.t("perm_microphone"), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(this, ID, BackgroundCalls.returnIntent(this),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val end = PendingIntent.getService(this, ID,
            Intent(this, MicrophoneCallService::class.java).setAction(STOP)
                .putExtra(TOKEN, BackgroundCalls.calls.latest()?.token),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(Tr.t("perm_microphone"))
            .setContentText(Tr.t("call_background_active"))
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(0, Tr.t("call_end"), end)
            .build()
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else startForeground(ID, notification)
        }.onFailure {
            BackgroundCalls.unavailable(this)
            // A foreground call remains usable if Android refuses the background service.
            stopSelf()
        }
        return START_NOT_STICKY
    }

    companion object {
        internal const val STOP = "ru.multibrowser.STOP_MICROPHONE_CALLS"
        internal const val TOKEN = "call_token"
        internal const val CHANNEL = "microphone_calls"
        internal const val ID = 80_001
    }
}
