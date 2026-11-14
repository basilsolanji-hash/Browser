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
    // Все профили используют один файл; commit(false) может изменить его в памяти.
    private var writeUncertain = false
    class Unavailable : IllegalStateException("Tab sets storage unavailable")
    sealed class SaveOpenResult {
        data class Saved(val set: TabSet) : SaveOpenResult()
        data object NoTabs : SaveOpenResult()
        data object Unavailable : SaveOpenResult()
        data object TabsUnavailable : SaveOpenResult()
    }
    enum class InsertResult { ADDED, EXISTS, UNAVAILABLE }

    @Synchronized internal fun read(ctx: Context, profile: Int): List<TabSet>? {
        if (writeUncertain) return null
        return runCatching {
            val raw = prefs(ctx).getString("s_$profile", null) ?: return@runCatching emptyList()
            val sets = parse(raw)
            if (sets.map { it.id }.toSet().size != sets.size) error("Duplicate tab set ID")
            sets
        }.getOrNull()
    }

    fun requireReadable(ctx: Context, profile: Int): List<TabSet> = read(ctx, profile) ?: throw Unavailable()
    fun list(ctx: Context, profile: Int): List<TabSet> = requireReadable(ctx, profile)

    private fun save(ctx: Context, profile: Int, sets: List<TabSet>): Boolean {
        if (writeUncertain) return false
        val encoded = toJson(sets).toString()
        val ok = runCatching { prefs(ctx).edit().putString("s_$profile", encoded).commit() }.getOrDefault(false)
        if (!ok) writeUncertain = true
        return ok
    }

    /** Строгий результат для интерфейса: отсутствие вкладок и ошибка хранения различны. */
    @Synchronized fun saveOpenResult(ctx: Context, profile: Int, name: String): SaveOpenResult {
        val sets = read(ctx, profile) ?: return SaveOpenResult.Unavailable
        val openTabs = Tabs.readForTabSets(ctx, profile) ?: return SaveOpenResult.TabsUnavailable
        val tabs = openTabs.filter { it.url.startsWith("http") }.map { it.title to it.url }
        if (tabs.isEmpty()) return SaveOpenResult.NoTabs
        var id: String
        do {
            id = "set" + runCatching { java.util.UUID.randomUUID().toString() }.getOrElse { return SaveOpenResult.Unavailable }
        } while (sets.any { it.id == id })
        val set = TabSet(id, name.trim().ifEmpty { Tr.t("tab_sets") }, System.currentTimeMillis(), tabs)
        return if (runCatching { save(ctx, profile, listOf(set) + sets) }.getOrDefault(false))
            SaveOpenResult.Saved(set) else SaveOpenResult.Unavailable
    }

    fun saveOpen(ctx: Context, profile: Int, name: String): TabSet? =
        (saveOpenResult(ctx, profile, name) as? SaveOpenResult.Saved)?.set

    @Synchronized fun insertIfAbsent(ctx: Context, profile: Int, set: TabSet): InsertResult {
        val sets = read(ctx, profile) ?: return InsertResult.UNAVAILABLE
        if (sets.any { it.id == set.id }) return InsertResult.EXISTS
        return if (runCatching { save(ctx, profile, sets + set) }.getOrDefault(false))
            InsertResult.ADDED else InsertResult.UNAVAILABLE
    }

    fun add(ctx: Context, profile: Int, set: TabSet): Boolean = insertIfAbsent(ctx, profile, set) != InsertResult.UNAVAILABLE

    @Synchronized fun remove(ctx: Context, profile: Int, id: String): Boolean {
        val sets = read(ctx, profile) ?: return false
        if (sets.none { it.id == id }) return false
        return runCatching { save(ctx, profile, sets.filterNot { it.id == id }) }.getOrDefault(false)
    }

    /** Открыть набор: вкладки добавляются к открытым; возвращает id первой. */
    fun restore(ctx: Context, profile: Int, set: TabSet): String? {
        if (Tabs.readForTabSets(ctx, profile) == null) throw Tabs.Unavailable()
        var first: String? = null
        for ((_, url) in set.tabs) {
            // Narrow guard only: a concurrent change can still occur between this read and add().
            if (Tabs.readForTabSets(ctx, profile) == null) throw Tabs.Unavailable()
            val id = try {
                Tabs.add(ctx, profile, url).id
            } catch (_: Exception) {
                // Prior additions or an in-memory change may already have happened.
                throw Tabs.Unavailable()
            }
            if (first == null) first = id
        }
        return first
    }

    fun toJson(sets: List<TabSet>) = JSONArray().apply {
        sets.forEach { s ->
            put(JSONObject().put("id", s.id).put("n", s.name).put("t", s.time).put("tabs", JSONArray().apply {
                s.tabs.forEach { (title, url) -> put(JSONObject().put("title", title).put("url", url)) }
            }))
        }
    }

    fun parse(json: String): List<TabSet> {
        val arr = JSONArray(json)
        val sets = (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            if (o.opt("id") !is String || o.getString("id").isBlank() ||
                (o.has("n") && o.opt("n") !is String) ||
                (o.has("t") && (o.opt("t") !is Number || runCatching {
                    java.math.BigDecimal(o.opt("t").toString()).longValueExact()
                }.isFailure))) error("Invalid tab set")
            val t = o.getJSONArray("tabs")
            TabSet(o.getString("id"), o.optString("n"), o.optLong("t"),
                (0 until t.length()).map { t.getJSONObject(it).let { x ->
                    if ((x.has("title") && x.opt("title") !is String) ||
                        x.opt("url") !is String || x.getString("url").isBlank()) error("Invalid tab set item")
                    x.optString("title") to x.getString("url")
                } })
        }
        return sets
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
        .put("passwords", Passwords.toJson(Passwords.requireReadable(ctx, profile)))
        .put("tabSets", TabSets.toJson(TabSets.requireReadable(ctx, profile)))
        .put("favorites", JSONArray().apply {
            Bookmarks.requireReadable(ctx).items.forEach { put(JSONObject().put("title", it.title).put("url", it.url).put("folder", it.folder)) }
        })
        .put("notes", JSONArray().apply {
            Notes.requireReadable(ctx).forEach { put(JSONObject().put("text", it.text).put("url", it.url)) }
        })

    /** Validate all present sections before writing; absent optional sections stay compatible. */
    private fun validatePayload(data: JSONObject) {
        fun optionalString(obj: JSONObject, name: String) {
            if (obj.has(name) && obj.opt(name) !is String) error("Invalid backup field")
        }
        fun requiredString(obj: JSONObject, name: String) {
            if (obj.opt(name) !is String) error("Invalid backup field")
        }
        fun requiredNonblankString(obj: JSONObject, name: String) {
            requiredString(obj, name)
            if (obj.getString(name).isBlank()) error("Empty backup field")
        }
        fun optionalInteger(obj: JSONObject, name: String) {
            if (!obj.has(name)) return
            val value = obj.opt(name)
            if (value !is Number || runCatching { java.math.BigDecimal(value.toString()).longValueExact() }.isFailure) {
                error("Invalid backup numeric field")
            }
        }
        fun section(name: String, check: (JSONObject) -> Unit) {
            if (!data.has(name)) return
            val arr = data.getJSONArray(name)
            for (i in 0 until arr.length()) check(arr.getJSONObject(i))
        }
        optionalInteger(data, "v")
        if (data.has("v") && exactInt(data.opt("v")) != 1) error("Invalid single-profile backup version")
        if (data.has("profiles")) error("Nested profiles are not supported")
        optionalString(data, "name")
        optionalString(data, "desc")
        section("passwords") { item ->
            requiredString(item, "g")
            requiredString(item, "o")
            requiredString(item, "p")
            optionalString(item, "u")
            optionalInteger(item, "t")
            if (Passwords.originOf(item.getString("o")) == null) error("Invalid backup origin")
        }
        section("tabSets") { item ->
            requiredNonblankString(item, "id")
            optionalString(item, "n")
            optionalInteger(item, "t")
            val tabs = item.getJSONArray("tabs")
            for (i in 0 until tabs.length()) {
                val tab = tabs.getJSONObject(i)
                optionalString(tab, "title")
                requiredNonblankString(tab, "url")
            }
        }
        section("favorites") { item ->
            optionalString(item, "title")
            requiredNonblankString(item, "url")
            optionalString(item, "folder")
        }
        section("notes") { item ->
            requiredNonblankString(item, "text")
            optionalString(item, "url")
        }
    }

    /** Добавить данные из копии в профиль; уже имеющееся не дублируется. */
    fun apply(ctx: Context, profile: Int, data: JSONObject): Restored {
        validatePayload(data)
        Notes.requireReadable(ctx)
        Bookmarks.requireReadable(ctx)
        Passwords.requireReadable(ctx, profile)
        TabSets.requireReadable(ctx, profile)
        if (Profiles.customName(ctx, profile).isEmpty()) data.optString("name").takeIf { it.isNotBlank() }?.let { Profiles.rename(ctx, profile, it) }
        if (Profiles.get(ctx, profile).description.isEmpty()) data.optString("desc").takeIf { it.isNotBlank() }?.let { Profiles.setDescription(ctx, profile, it) }
        val logins = Passwords.parse(data.optJSONArray("passwords")?.toString() ?: "[]")
        // Check and insert atomically: an existing site/login is never replaced.
        var importedPasswords = 0
        logins.forEach {
            when (Passwords.insertIfAbsent(ctx, profile, it.origin, it.username, it.password)) {
                Passwords.InsertResult.ADDED -> importedPasswords++
                Passwords.InsertResult.EXISTS -> Unit
                Passwords.InsertResult.UNAVAILABLE -> throw Passwords.Unavailable()
            }
        }
        val sets = TabSets.parse(data.optJSONArray("tabSets")?.toString() ?: "[]")
        var importedSets = 0
        sets.forEach {
            when (TabSets.insertIfAbsent(ctx, profile, it)) {
                TabSets.InsertResult.ADDED -> importedSets++
                TabSets.InsertResult.EXISTS -> Unit
                TabSets.InsertResult.UNAVAILABLE -> throw TabSets.Unavailable()
            }
        }
        var favorites = 0
        data.optJSONArray("favorites")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val url = o.optString("url")
                if (url.isNotBlank()) {
                    val folder = o.optString("folder").ifBlank { Bookmarks.ROOT }
                    when (Bookmarks.addIfAbsent(ctx, o.optString("title"), url, folder)) {
                        Bookmarks.AddResult.ADDED -> favorites++
                        Bookmarks.AddResult.EXISTS -> Unit
                        Bookmarks.AddResult.UNAVAILABLE -> throw Bookmarks.Unavailable()
                    }
                }
            }
        }
        var notes = 0
        val have = Notes.requireReadable(ctx).map { it.text to it.url }.toMutableSet()
        data.optJSONArray("notes")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val note = o.optString("text").trim() to o.optString("url")
                if (note.first.isNotBlank() && note !in have) {
                    when (Notes.add(ctx, note.first, note.second)) {
                        Notes.AddResult.SAVED -> Unit
                        Notes.AddResult.FULL -> throw Notes.Full()
                        else -> throw Notes.Unavailable()
                    }
                    have.add(note)
                    notes++
                }
            }
        }
        return Restored(importedPasswords, importedSets, favorites, notes)
    }

    /** Копия всех профилей одним файлом: {"v":2,"profiles":[{"id":N,"data":{…}}]}. */
    fun collectAll(ctx: Context): JSONObject = JSONObject().put("v", 2).put("profiles", JSONArray().apply {
        Profiles.order(ctx).forEach { id -> put(JSONObject().put("id", id).put("data", collect(ctx, id))) }
    })

    /** Восстановить копию: v2 — в профили с теми же номерами (если такие есть), v1 — в [profile]. */
    fun applyAny(ctx: Context, profile: Int, data: JSONObject): Restored {
        Notes.requireReadable(ctx)
        Bookmarks.requireReadable(ctx)
        val payloadVersion = if (data.has("v")) exactInt(data.opt("v")) ?: error("Invalid backup payload version") else 1
        if (payloadVersion !in 1..2) error("Unsupported backup payload version")
        if (payloadVersion == 2 && !data.has("profiles")) error("Missing backup profiles")
        val all = if (data.has("profiles")) data.getJSONArray("profiles") else return apply(ctx, profile, data)
        var p = 0; var t = 0; var f = 0; var n = 0
        val count = Settings.profileCount(ctx)
        // Validate every destination before mutating any profile; never silently skip one.
        val seen = mutableSetOf<Int>()
        val targets = (0 until all.length()).map { i ->
            val entry = all.getJSONObject(i)
            val id = exactInt(entry.opt("id"))?.takeIf { it in 1..count && seen.add(it) }
                ?: error("Invalid or unavailable backup profile")
            val profileData = entry.getJSONObject("data")
            validatePayload(profileData)
            id to profileData
        }
        targets.forEach { (id, _) ->
            Passwords.requireReadable(ctx, id)
            TabSets.requireReadable(ctx, id)
        }
        for ((id, profileData) in targets) {
            val r = apply(ctx, id, profileData)
            p += r.passwords; t += r.tabSets; f += r.favorites; n += r.notes
        }
        return Restored(p, t, f, n)
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
        val version = exactInt(o.opt("v")) ?: error("Invalid backup version")
        val iterations = when {
            version == 1 && !o.has("iter") -> ITERATIONS
            version == 2 -> exactInt(o.opt("iter"))?.takeIf { it in 100_000..5_000_000 }
                ?: error("Invalid backup iterations")
            else -> error("Unsupported backup format")
        }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(password, unb64(o.getString("salt")), iterations), GCMParameterSpec(128, unb64(o.getString("iv"))))
        JSONObject(String(c.doFinal(unb64(o.getString("data"))), Charsets.UTF_8))
    }.getOrNull()

    /** Reject strings, fractions, and overflow rather than coercing them. */
    private fun exactInt(value: Any?): Int? {
        if (value !is Number) return null
        return runCatching { java.math.BigDecimal(value.toString()).intValueExact() }.getOrNull()
    }

    private fun key(password: String, salt: ByteArray, iterations: Int = ITERATIONS) = SecretKeySpec(
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
            .generateSecret(PBEKeySpec(password.toCharArray(), salt, iterations, 256)).encoded, "AES")

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)
}
