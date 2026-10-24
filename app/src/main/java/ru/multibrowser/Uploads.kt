package ru.multibrowser

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

/**
 * Файлы, выбранные для отправки сайту (кнопка «+» в Claude, вложения в почте). Окно выбора
 * отдаёт content://, а GeckoView читает загружаемые файлы только по пути на диске — поэтому,
 * как Firefox, копируем их во временную папку с исходными именами и отдаём file://.
 */
object Uploads {
    private const val KEEP_MS = 24 * 60 * 60 * 1000L

    /** Скопировать выбранные файлы (вызывать не в главном потоке); не прочитанные — пропускаются. */
    fun copy(ctx: Context, uris: List<Uri>): List<Uri> {
        val root = File(ctx.cacheDir, "uploads").apply { mkdirs() }
        cleanup(root)
        val dir = File(root, System.currentTimeMillis().toString()).apply { mkdirs() }
        return uris.mapIndexedNotNull { i, uri ->
            runCatching {
                if (uri.scheme == "file") return@runCatching uri
                val name = safeName(displayName(ctx, uri) ?: "file_${i + 1}")
                val target = File(dir, name).let { if (it.exists()) File(dir, "${i + 1}_$name") else it }
                ctx.contentResolver.openInputStream(uri)!!.use { input -> target.outputStream().use { input.copyTo(it) } }
                Uri.fromFile(target)
            }.onFailure { Diag.log("upload", "не удалось прочитать: ${it.message}") }.getOrNull()
        }
    }

    /** Копии старше суток удаляем — сайт их уже получил. */
    private fun cleanup(root: File) {
        val old = System.currentTimeMillis() - KEEP_MS
        root.listFiles()?.filter { it.lastModified() < old }?.forEach { it.deleteRecursively() }
    }

    private fun displayName(ctx: Context, uri: Uri): String? = runCatching {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    internal fun safeName(name: String) =
        name.replace(Regex("""[/\\:*?"<>|\u0000-\u001f]"""), "_").trim().take(120).ifBlank { "file" }
}
