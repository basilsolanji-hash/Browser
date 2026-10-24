package ru.multibrowser

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.content.pm.PackageManager
import android.text.format.Formatter
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.mozilla.geckoview.WebResponse
import java.io.File
import java.io.InputStream
import java.net.URLDecoder
import kotlin.concurrent.thread

/** Сохраняет скачиваемые файлы (вложения Gmail и т.п.) в «Загрузки/Ось». */
object Downloads {
    private const val FOLDER = "Ось"
    private var permissionSeq = 0

    /**
     * Скачивание по разрешению сайта (SitePermissions.DOWNLOADS: спросить/разрешить/запретить).
     * [pageUrl] — страница, с которой скачивают. Отказ — поток ответа закрывается.
     */
    fun request(activity: AppCompatActivity, pageUrl: String?, response: WebResponse, privateMode: Boolean = false) {
        val name = fileName(response)
        val size = header(response, "Content-Length")?.toLongOrNull()?.let { " (${Formatter.formatShortFileSize(activity, it)})" }.orEmpty()
        SitePermissions.check(activity, pageUrl, SitePermissions.Kind.DOWNLOADS,
            { host -> Tr.t("perm_q_downloads", host, name + size) }, privateMode) { ok ->
            if (!ok) { runCatching { response.body?.close() }; return@check }
            withStorage(activity) { save(activity, response) }
        }
    }

    /** Android 8–9: в общую папку «Загрузки» можно писать только с разрешением — спрашиваем один раз. */
    private fun withStorage(activity: AppCompatActivity, then: () -> Unit) {
        val legacy = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        if (!legacy || ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED || activity.isFinishing) return then()
        lateinit var launcher: androidx.activity.result.ActivityResultLauncher<String>
        launcher = activity.activityResultRegistry.register("os_storage_${permissionSeq++}",
            ActivityResultContracts.RequestPermission()) { launcher.unregister(); then() }
        runCatching { launcher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) }.onFailure { launcher.unregister(); then() }
    }

    fun save(activity: Activity, response: WebResponse) {
        val body = response.body ?: return
        val name = fileName(response)
        val mime = header(response, "Content-Type")?.substringBefore(';')?.trim()
            ?.takeIf { it.isNotEmpty() } ?: "application/octet-stream"
        val app = activity.applicationContext
        val total = header(response, "Content-Length")?.toLongOrNull()?.takeIf { it > 0 } ?: -1L
        val task = Task(nextId++, name, total)
        active += task
        Toast.makeText(app, Tr.t("downloading", name), Toast.LENGTH_SHORT).show()
        DownloadProgress.update(app, task)
        thread(name = "download") {
            val result = runCatching { body.use { write(app, name, mime, it, task) } }
            active -= task
            val uri = result.getOrNull()
            if (uri != null) DownloadLog.add(app, name, mime, uri.toString())
            DownloadProgress.finish(app, task, uri != null)
            activity.runOnUiThread {
                val msg = when {
                    uri != null -> Tr.t("saved_to", FOLDER, name)
                    task.cancelled -> Tr.t("dl_cancelled", name)
                    else -> Tr.t("download_failed", name)
                }
                Toast.makeText(app, msg, Toast.LENGTH_LONG).show()
            }
        }
    }

    /** Идущая загрузка: сколько скачано из скольких (total = -1 — сайт не сообщил размер). */
    class Task(val id: Int, val name: String, val total: Long) {
        @Volatile var done = 0L
        @Volatile var cancelled = false
        val percent get() = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 100) else -1
    }

    /** Загрузки, которые идут сейчас (для уведомления и экрана «Загрузки»). */
    val active = java.util.concurrent.CopyOnWriteArrayList<Task>()
    private var nextId = 1

    fun cancel(id: Int) {
        active.firstOrNull { it.id == id }?.cancelled = true
    }

    /** Копирование с подсчётом байтов; отмена — исключение, частичный файл удаляет вызывающий. */
    private fun copy(ctx: Context, input: InputStream, out: java.io.OutputStream, task: Task) {
        val buf = ByteArray(64 * 1024)
        var last = 0L
        while (true) {
            if (task.cancelled) throw java.io.InterruptedIOException("cancelled")
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            task.done += n
            val now = System.currentTimeMillis()
            if (now - last > 400) { last = now; DownloadProgress.update(ctx, task) }
        }
    }

    /** Записывает файл и возвращает uri для открытия из списка загрузок. */
    private fun write(ctx: Context, name: String, mime: String, input: InputStream, task: Task): Uri {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("MediaStore insert failed")
            runCatching { ctx.contentResolver.openOutputStream(uri)!!.use { copy(ctx, input, it, task) } }
                .onFailure { ctx.contentResolver.delete(uri, null, null); throw it }
            return uri
        } else {
            // С разрешением — общая папка «Загрузки/Ось», без него — папка приложения.
            val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
            @Suppress("DEPRECATION")
            val base = if (granted) Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                else ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            val dir = File(base, FOLDER).apply { mkdirs() }
            val file = File(dir, name)
            runCatching { file.outputStream().use { copy(ctx, input, it, task) } }
                .onFailure { file.delete(); throw it }
            return Uri.fromFile(file)
        }
    }

    internal fun header(response: WebResponse, key: String): String? =
        response.headers.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }?.value

    internal fun fileName(response: WebResponse): String {
        val disposition = header(response, "Content-Disposition").orEmpty()
        val fromHeader = Regex("""filename\*=(?:UTF-8|utf-8)''([^;]+)""").find(disposition)
            ?.groupValues?.get(1)?.let { URLDecoder.decode(it, "UTF-8") }
            ?: Regex("""filename="?([^";]+)"?""").find(disposition)?.groupValues?.get(1)
        val name = fromHeader ?: Uri.parse(response.uri).lastPathSegment
        return name?.replace(Regex("""[\\/:*?"<>|]"""), "_")?.trim()?.takeIf { it.isNotEmpty() } ?: "download"
    }
}
