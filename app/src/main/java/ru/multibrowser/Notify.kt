package ru.multibrowser

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.mozilla.geckoview.WebNotification
import org.mozilla.geckoview.WebNotificationDelegate

/**
 * Уведомления сайтов (Notification API) → системные уведомления Android. Работают, пока вкладка
 * сайта жива в памяти; push при закрытом сайте требует сервера (docs/WEBPUSH.md). В уведомлении —
 * профиль, из которого оно пришло; нажатие открывает эту вкладку и передаёт клик сайту.
 */
object Notify {
    private const val CHANNEL = "sites"
    const val EXTRA_TAG = "notification_tag"

    // Показанные уведомления: ключ → уведомление движка (для click() и закрытия).
    private val active = HashMap<String, WebNotification>()
    private var permissionSeq = 0

    fun delegate(ctx: Context): WebNotificationDelegate {
        val app = ctx.applicationContext
        return object : WebNotificationDelegate {
            override fun onShowNotification(notification: WebNotification) = show(app, notification)
            override fun onCloseNotification(notification: WebNotification) = close(app, notification)
        }
    }

    private fun key(n: WebNotification) = n.tag.takeIf { it.isNotBlank() } ?: "${n.source}|${n.title}"

    private fun show(ctx: Context, n: WebNotification) {
        val host = n.source?.let { Uri.parse(it).host }
        if (!allowed(ctx)) {
            Diag.log("notify", "нет системного разрешения: $host")
            return
        }
        ensureChannel(ctx)
        val k = key(n)
        // Чья вкладка: последняя использованная сессия с этим сайтом.
        val tab = if (n.privateBrowsing) null else host?.let { Gecko.tabForHost(it) }
        val who = when {
            n.privateBrowsing -> Tr.t("incognito")
            tab != null -> Profiles.get(ctx, tab.first).name
            else -> null
        }
        val open = Intent(ctx, BrowserActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(EXTRA_TAG, k)
            .apply {
                if (tab != null) {
                    putExtra(BrowserActivity.EXTRA_PROFILE, tab.first)
                    putExtra(BrowserActivity.EXTRA_SITE, tab.second)
                }
            }
        val pi = PendingIntent.getActivity(ctx, k.hashCode(), open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val builder = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(n.title?.takeIf { it.isNotBlank() } ?: host ?: "Ось")
            .setContentText(n.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.text))
            .setSubText(listOfNotNull(who, host).joinToString(" · "))
            .setColor(Ui.ACCENT)
            .setAutoCancel(true)
            .setSilent(n.silent)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        runCatching { NotificationManagerCompat.from(ctx).notify(k.hashCode(), builder.build()) }
            .onSuccess {
                synchronized(active) { active[k] = n }
                Diag.log("notify", "показано: $host (${who ?: "?"})")
            }
            .onFailure { Diag.log("notify", "ошибка: ${it.message}") }
    }

    private fun close(ctx: Context, n: WebNotification) {
        val k = key(n)
        NotificationManagerCompat.from(ctx).cancel(k.hashCode())
        synchronized(active) { active.remove(k) }
    }

    /** Нажали на уведомление — сообщаем сайту (событие notificationclick / onclick). */
    fun clicked(tag: String) {
        synchronized(active) { active.remove(tag) }?.let { runCatching { it.click() } }
    }

    fun allowed(ctx: Context) = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** После согласия на сайте — системный запрос (Android 13+), если разрешения ещё нет. */
    fun requestPermission(activity: AppCompatActivity) {
        if (allowed(activity) || activity.isFinishing || activity.isDestroyed) return
        lateinit var launcher: ActivityResultLauncher<String>
        launcher = activity.activityResultRegistry.register("os_notify_${permissionSeq++}",
            ActivityResultContracts.RequestPermission()) { launcher.unregister() }
        runCatching { launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }.onFailure { launcher.unregister() }
    }

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, Tr.t("notif_channel"), NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = Tr.t("notif_channel_desc") })
    }
}
