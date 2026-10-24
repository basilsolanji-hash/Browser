package ru.multibrowser

import android.content.Context

data class Profile(
    val id: Int,
    val name: String,
    val color: Int,
    val email: String?,
    val unread: Int,
)

object Profiles {
    const val COUNT = 15
    const val HOME_URL = "https://mail.google.com/"

    private val COLORS = intArrayOf(
        0xFFE53935.toInt(), 0xFF8E24AA.toInt(), 0xFF3949AB.toInt(), 0xFF1E88E5.toInt(), 0xFF00897B.toInt(),
        0xFF43A047.toInt(), 0xFFF4511E.toInt(), 0xFF6D4C41.toInt(), 0xFF546E7A.toInt(), 0xFFD81B60.toInt(),
        0xFF5E35B1.toInt(), 0xFF039BE5.toInt(), 0xFF7CB342.toInt(), 0xFFFB8C00.toInt(), 0xFF00ACC1.toInt(),
    )

    private val EMAIL = Regex("""[\w.+-]+@[\w-]+(\.[\w-]+)+""")
    private val UNREAD = Regex("""\((\d+)\)""")

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("profiles", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<Profile> = (1..COUNT).map { get(ctx, it) }

    fun get(ctx: Context, id: Int): Profile {
        val p = prefs(ctx)
        return Profile(
            id = id,
            name = p.getString("name_$id", null) ?: "Профиль $id",
            color = COLORS[(id - 1) % COLORS.size],
            email = p.getString("email_$id", null),
            unread = p.getInt("unread_$id", 0),
        )
    }

    fun rename(ctx: Context, id: Int, name: String) {
        prefs(ctx).edit().putString("name_$id", name.trim()).apply()
    }

    fun lastUrl(ctx: Context, id: Int): String {
        val url = prefs(ctx).getString("url_$id", null) ?: return HOME_URL
        // Адреса устаревшей «простой» версии Gmail не восстанавливаем.
        return if (url.contains("/mail/mu/")) HOME_URL else url
    }

    fun saveLastUrl(ctx: Context, id: Int, url: String) {
        // Страницы входа не запоминаем, чтобы профиль не открывался на форме логина.
        if (url.startsWith("http") && !url.contains("accounts.google.com")) {
            prefs(ctx).edit().putString("url_$id", url).apply()
        }
    }

    /** Заголовок Gmail выглядит как «Входящие (3) - name@gmail.com - Gmail»: берём адрес и число непрочитанных. */
    fun updateFromTitle(ctx: Context, id: Int, title: String?) {
        if (title == null || !title.contains("Gmail")) return
        val email = EMAIL.find(title)?.value ?: return
        val unread = UNREAD.find(title)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        prefs(ctx).edit().putString("email_$id", email).putInt("unread_$id", unread).apply()
    }

    fun forget(ctx: Context, id: Int) {
        prefs(ctx).edit().remove("email_$id").remove("unread_$id").remove("url_$id").apply()
    }
}
