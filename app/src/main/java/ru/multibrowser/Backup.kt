package ru.multibrowser

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Сохранённый набор вкладок профиля: название, когда сохранён, адреса с заголовками. */
data class TabSet(val id: String, val name: String, val time: Long, val tabs: List<Pair<String, String>>)

/** Наборы вкладок: сохранить открытые вкладки профиля и потом открыть их снова одним нажатием. */
object TabSets {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("tab_sets", Context.MODE_PRIVATE)

    fun list(ctx: Context, profile: Int): List<TabSet> =
        runCatching { parse(prefs(ctx).getString("s_$profile", null) ?: "[]") }.getOrDefault(emptyList())

    private fun save(ctx: Context, profile: Int, sets: List<TabSet>) {
        prefs(ctx).edit().putString("s_$profile", toJson(sets).toString()).apply()
    }

    /** Открытые вкладки профиля (без стартовых страниц) → новый набор; null, если сохранять нечего. */
    fun saveOpen(ctx: Context, profile: Int, name: String): TabSet? {
        val tabs = Tabs.list(ctx, profile).filter { it.url.startsWith("http") }.map { it.title to it.url }
        if (tabs.isEmpty()) return null
        val set = TabSet("set" + System.nanoTime(), name.trim().ifEmpty { Tr.t("tab_sets") }, System.currentTimeMillis(), tabs)
        save(ctx, profile, listOf(set) + list(ctx, profile))
        return set
    }

    fun add(ctx: Context, profile: Int, set: TabSet) {
        if (list(ctx, profile).any { it.id == set.id }) return
        save(ctx, profile, list(ctx, profile) + set)
    }

    fun remove(ctx: Context, profile: Int, id: String) = save(ctx, profile, list(ctx, profile).filterNot { it.id == id })

    /** Открыть набор: вкладки добавляются к открытым; возвращает id первой. */
    fun restore(ctx: Context, profile: Int, set: TabSet): String? =
        set.tabs.map { (_, url) -> Tabs.add(ctx, profile, url).id }.firstOrNull()

    fun toJson(sets: List<TabSet>) = JSONArray().apply {
        sets.forEach { s ->
            put(JSONObject().put("id", s.id).put("n", s.name).put("t", s.time).put("tabs", JSONArray().apply {
                s.tabs.forEach { (title, url) -> put(JSONObject().put("title", title).put("url", url)) }
            }))
        }
    }

    fun parse(json: String): List<TabSet> {
        val arr = JSONArray(json)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val t = o.getJSONArray("tabs")
            TabSet(o.getString("id"), o.optString("n"), o.optLong("t"),
                (0 until t.length()).map { t.getJSONObject(it).let { x -> x.optString("title") to x.getString("url") } })
        }
    }
}

/**
 * Резервная копия профиля в файл: пароли, наборы вкладок, избранное, заметки, имя и описание.
 * Файл зашифрован паролем пользователя (PBKDF2-SHA256 → AES-256-GCM); без пароля не открыть.
 * Никуда не отправляется — пользователь сам выбирает, где сохранить файл.
 */
object Backup {
    private const val ITERATIONS = 120_000

    class Restored(val passwords: Int, val tabSets: Int, val favorites: Int, val notes: Int)

    /** Данные профиля в JSON (без шифрования). */
    fun collect(ctx: Context, profile: Int): JSONObject = JSONObject()
        .put("v", 1)
        .put("name", Profiles.customName(ctx, profile))
        .put("desc", Profiles.get(ctx, profile).description)
        .put("passwords", Passwords.toJson(Passwords.list(ctx, profile)))
        .put("tabSets", TabSets.toJson(TabSets.list(ctx, profile)))
        .put("favorites", JSONArray().apply {
            Bookmarks.all(ctx).forEach { put(JSONObject().put("title", it.title).put("url", it.url).put("folder", it.folder)) }
        })
        .put("notes", JSONArray().apply {
            Notes.list(ctx).forEach { put(JSONObject().put("text", it.text).put("url", it.url)) }
        })

    /** Добавить данные из копии в профиль; уже имеющееся не дублируется. */
    fun apply(ctx: Context, profile: Int, data: JSONObject): Restored {
        if (Profiles.customName(ctx, profile).isEmpty()) data.optString("name").takeIf { it.isNotBlank() }?.let { Profiles.rename(ctx, profile, it) }
        if (Profiles.get(ctx, profile).description.isEmpty()) data.optString("desc").takeIf { it.isNotBlank() }?.let { Profiles.setDescription(ctx, profile, it) }
        val logins = Passwords.parse(data.optJSONArray("passwords")?.toString() ?: "[]")
        logins.forEach { Passwords.upsert(ctx, profile, it.origin, it.username, it.password) }
        val sets = TabSets.parse(data.optJSONArray("tabSets")?.toString() ?: "[]")
        sets.forEach { TabSets.add(ctx, profile, it) }
        var favorites = 0
        data.optJSONArray("favorites")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val url = o.optString("url")
                if (url.isNotBlank() && !Bookmarks.contains(ctx, url)) {
                    val folder = o.optString("folder").ifBlank { Bookmarks.ROOT }
                    if (folder != Bookmarks.ROOT) Bookmarks.addFolder(ctx, folder)
                    Bookmarks.add(ctx, o.optString("title"), url, folder)
                    favorites++
                }
            }
        }
        var notes = 0
        val have = Notes.list(ctx).map { it.text to it.url }.toSet()
        data.optJSONArray("notes")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val note = o.optString("text") to o.optString("url")
                if (note.first.isNotBlank() && note !in have) { Notes.add(ctx, note.first, note.second); notes++ }
            }
        }
        return Restored(logins.size, sets.size, favorites, notes)
    }

    fun encrypt(data: JSONObject, password: String): String {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key(password, salt), GCMParameterSpec(128, iv)) }
        val body = c.doFinal(data.toString().toByteArray(Charsets.UTF_8))
        return JSONObject().put("app", "os-browser").put("v", 1)
            .put("salt", b64(salt)).put("iv", b64(iv)).put("data", b64(body)).toString()
    }

    /** null — неверный пароль или повреждённый файл. */
    fun decrypt(file: String, password: String): JSONObject? = runCatching {
        val o = JSONObject(file)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(password, unb64(o.getString("salt"))), GCMParameterSpec(128, unb64(o.getString("iv"))))
        JSONObject(String(c.doFinal(unb64(o.getString("data"))), Charsets.UTF_8))
    }.getOrNull()

    private fun key(password: String, salt: ByteArray) = SecretKeySpec(
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256)).encoded, "AES")

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)
}
