package ru.multibrowser

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.text.format.Formatter
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Уведомление о скачивании: имя файла, процент и «скачано из» (или только «скачано», если
 * сайт не сообщил размер), кнопка «Отмена»; в конце — «Скачано» с переходом в «Загрузки».
 */
object DownloadProgress {
    private const val CHANNEL = "downloads"
    private const val NOTIFY_BASE = 70_000
    const val ACTION_CANCEL = "ru.multibrowser.DOWNLOAD_CANCEL"
    const val EXTRA_ID = "download_id"

    /** Подпись прогресса — общая для уведомления и экрана «Загрузки». */
    fun label(ctx: Context, t: Downloads.Task): String {
        val done = Formatter.formatShortFileSize(ctx, t.done)
        return if (t.total > 0) Tr.t("dl_progress", t.percent, done, Formatter.formatShortFileSize(ctx, t.total))
        else Tr.t("dl_progress_unknown", done)
    }

    fun update(ctx: Context, t: Downloads.Task) {
        if (!Notify.allowed(ctx)) return
        ensureChannel(ctx)
        val cancel = PendingIntent.getBroadcast(ctx, t.id,
            Intent(ctx, CancelReceiver::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_ID, t.id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(t.name)
            .setContentText(label(ctx, t))
            .setProgress(100, t.percent.coerceAtLeast(0), t.total <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openList(ctx, t.id))
            .addAction(0, Tr.t("cancel"), cancel)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(NOTIFY_BASE + t.id, n) }
    }

    fun finish(ctx: Context, t: Downloads.Task, ok: Boolean) {
        val nm = NotificationManagerCompat.from(ctx)
        nm.cancel(NOTIFY_BASE + t.id)
        if (!ok || !Notify.allowed(ctx)) return
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(t.name)
            .setContentText(Tr.t("dl_done", Formatter.formatShortFileSize(ctx, t.done)))
            .setAutoCancel(true)
            .setContentIntent(openList(ctx, t.id))
            .build()
        runCatching { nm.notify(NOTIFY_BASE + t.id, n) }
    }

    private fun openList(ctx: Context, id: Int) = PendingIntent.getActivity(ctx, NOTIFY_BASE + id,
        Intent(ctx, DownloadsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CHANNEL, Tr.t("downloads"), NotificationManager.IMPORTANCE_LOW))
    }

    /** Кнопка «Отмена» в уведомлении. */
    class CancelReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == ACTION_CANCEL) Downloads.cancel(intent.getIntExtra(EXTRA_ID, -1))
        }
    }
}
