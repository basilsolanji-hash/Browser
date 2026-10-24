package ru.multibrowser

import android.content.Context
import android.graphics.Color

data class Profile(
    val id: Int,
    val name: String,
    val color: Int,
    val email: String?,
    val unread: Int,
)

object Profiles {

    private val COLORS = intArrayOf(
        0xFFE53935.toInt(), 0xFF8E24AA.toInt(), 0xFF3949AB.toInt(), 0xFF1E88E5.toInt(), 0xFF00897B.toInt(),
        0xFF43A047.toInt(), 0xFFF4511E.toInt(), 0xFF6D4C41.toInt(), 0xFF546E7A.toInt(), 0xFFD81B60.toInt(),
        0xFF5E35B1.toInt(), 0xFF039BE5.toInt(), 0xFF7CB342.toInt(), 0xFFFB8C00.toInt(), 0xFF00ACC1.toInt(),
    )

    private val EMAIL = Regex("""[\w.+-]+@[\w-]+(\.[\w-]+)+""")
    private val UNREAD = Regex("""\((\d+)\)""")

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("profiles", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<Profile> = (1..Settings.profileCount(ctx)).map { get(ctx, it) }

    /** Первые 15 — фирменная палитра, дальше — цвета по «золотому углу», чтобы соседние не совпадали. */
    fun color(id: Int): Int =
        if (id <= COLORS.size) COLORS[id - 1]
        else Color.HSVToColor(floatArrayOf((id * 137.5f) % 360f, 0.62f, 0.78f))

    fun get(ctx: Context, id: Int): Profile {
        val p = prefs(ctx)
        return Profile(
            id = id,
            name = p.getString("name_$id", null) ?: Tr.t("profile_n", id),
            color = color(id),
            email = p.getString("email_$id", null),
            unread = p.getInt("unread_$id", 0),
        )
    }

    /** Пустое имя возвращает название по умолчанию «Профиль N». */
    fun rename(ctx: Context, id: Int, name: String) {
        val edit = prefs(ctx).edit()
        if (name.isBlank()) edit.remove("name_$id") else edit.putString("name_$id", name.trim())
        edit.apply()
    }

    fun customName(ctx: Context, id: Int): String = prefs(ctx).getString("name_$id", null).orEmpty()

    private fun urlKey(id: Int, pin: Pin) = "url_${id}_${pin.id}"

    fun lastUrl(ctx: Context, id: Int, pin: Pin): String {
        val url = prefs(ctx).getString(urlKey(id, pin), null) ?: return pin.url
        // Адреса устаревшей «простой» версии Gmail не восстанавливаем.
        return if (url.contains("/mail/mu/")) pin.url else url
    }

    fun saveLastUrl(ctx: Context, id: Int, pin: Pin, url: String) {
        // Страницы входа не запоминаем, чтобы вкладка не открывалась на форме логина.
        if (url.startsWith("http") && !url.contains("accounts.google.com")) {
            prefs(ctx).edit().putString(urlKey(id, pin), url).apply()
        }
    }

    /** Последняя открытая вкладка — с неё стартует профиль. */
    fun lastPinId(ctx: Context): String? = prefs(ctx).getString("pin", null)

    fun saveLastPinId(ctx: Context, pinId: String) {
        prefs(ctx).edit().putString("pin", pinId).apply()
    }

    /** Заголовок Gmail выглядит как «Входящие (3) - name@gmail.com - Gmail»: берём адрес и число непрочитанных. */
    fun updateFromTitle(ctx: Context, id: Int, title: String?) {
        if (title == null || !title.contains("Gmail")) return
        val email = EMAIL.find(title)?.value ?: return
        val unread = UNREAD.find(title)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        prefs(ctx).edit().putString("email_$id", email).putInt("unread_$id", unread).apply()
    }

    fun forget(ctx: Context, id: Int) {
        prefs(ctx).edit().remove("email_$id").remove("unread_$id").apply {
            Pins.all(ctx).forEach { remove(urlKey(id, it)) }
        }.apply()
    }
}
