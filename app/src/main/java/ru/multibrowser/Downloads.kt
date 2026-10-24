package ru.multibrowser

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import org.mozilla.geckoview.WebResponse
import java.io.File
import java.io.InputStream
import java.net.URLDecoder
import kotlin.concurrent.thread

/** Сохраняет скачиваемые файлы (вложения Gmail и т.п.) в «Загрузки/Ось». */
object Downloads {
    private const val FOLDER = "Ось"

    fun save(activity: Activity, response: WebResponse) {
        val body = response.body ?: return
        val name = fileName(response)
        val mime = header(response, "Content-Type")?.substringBefore(';')?.trim()
            ?.takeIf { it.isNotEmpty() } ?: "application/octet-stream"
        val app = activity.applicationContext
        Toast.makeText(app, "Скачивание: $name", Toast.LENGTH_SHORT).show()
        thread(name = "download") {
            val ok = runCatching { body.use { write(app, name, mime, it) } }.isSuccess
            activity.runOnUiThread {
                val msg = if (ok) "Сохранено в Загрузки/$FOLDER: $name" else "Не удалось скачать $name"
                Toast.makeText(app, msg, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun write(ctx: Context, name: String, mime: String, input: InputStream) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("MediaStore insert failed")
            ctx.contentResolver.openOutputStream(uri)!!.use { input.copyTo(it) }
        } else {
            val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER).apply { mkdirs() }
            File(dir, name).outputStream().use { input.copyTo(it) }
        }
    }

    private fun header(response: WebResponse, key: String): String? =
        response.headers.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }?.value

    private fun fileName(response: WebResponse): String {
        val disposition = header(response, "Content-Disposition").orEmpty()
        val fromHeader = Regex("""filename\*=(?:UTF-8|utf-8)''([^;]+)""").find(disposition)
            ?.groupValues?.get(1)?.let { URLDecoder.decode(it, "UTF-8") }
            ?: Regex("""filename="?([^";]+)"?""").find(disposition)?.groupValues?.get(1)
        val name = fromHeader ?: Uri.parse(response.uri).lastPathSegment
        return name?.replace(Regex("""[\\/:*?"<>|]"""), "_")?.trim()?.takeIf { it.isNotEmpty() } ?: "download"
    }
}
