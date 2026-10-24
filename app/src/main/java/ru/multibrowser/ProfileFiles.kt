package ru.multibrowser

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File

/**
 * Файлы, прикреплённые к профилю (договоры, реквизиты, инструкции — что нужно под рукой в этом
 * аккаунте). Копии лежат во внутренней памяти: files/profile_files/<id>/, другим приложениям
 * недоступны и не стираются при «Выйти и очистить» — это данные пользователя, а не сайта.
 */
object ProfileFiles {
    fun dir(ctx: Context, id: Int) = File(ctx.filesDir, "profile_files/$id").apply { mkdirs() }

    fun list(ctx: Context, id: Int): List<File> =
        dir(ctx, id).listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() }.orEmpty()

    fun count(ctx: Context, id: Int): Int = File(ctx.filesDir, "profile_files/$id").listFiles()?.count { it.isFile } ?: 0

    /** Скопировать выбранный документ в папку профиля (вызывать не в главном потоке). */
    fun add(ctx: Context, id: Int, uri: Uri): File {
        val name = safeName(displayName(ctx, uri) ?: "file")
        val target = unique(dir(ctx, id), name)
        ctx.contentResolver.openInputStream(uri)!!.use { input -> target.outputStream().use { input.copyTo(it) } }
        return target
    }

    fun rename(ctx: Context, file: File, name: String): Boolean {
        val clean = safeName(name)
        if (clean.isBlank() || clean == file.name) return false
        return file.renameTo(unique(file.parentFile ?: return false, clean))
    }

    /** Файл должен лежать в папке этого профиля — защита от подмены пути. */
    fun owns(ctx: Context, id: Int, file: File) =
        file.canonicalPath.startsWith(dir(ctx, id).canonicalPath + File.separator)

    private fun displayName(ctx: Context, uri: Uri): String? = runCatching {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/')

    private fun safeName(name: String) = name.replace(Regex("""[/\\:*?"<>|\u0000-\u001f]"""), "_").trim().take(120)

    /** «файл.pdf» → «файл (2).pdf», если имя занято. */
    private fun unique(dir: File, name: String): File {
        var f = File(dir, name)
        val base = name.substringBeforeLast('.', name)
        val ext = name.substringAfterLast('.', "").let { if (it.isEmpty() || it == name) "" else ".$it" }
        var n = 2
        while (f.exists()) f = File(dir, "$base ($n)$ext").also { n++ }
        return f
    }
}
