package ru.multibrowser

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.Autocomplete
import org.mozilla.geckoview.GeckoResult
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Сохранённый вход на сайт. [origin] — «https://example.com». */
data class Login(val guid: String, val origin: String, val username: String, val password: String, val time: Long)

/**
 * Пароли — свои у каждого профиля, только на телефоне: список шифруется ключом из Android
 * Keystore (AES-GCM), ключ не покидает устройство. Движок спрашивает пароли для сайта через
 * [storage]; отдаём только пароли профиля, который сейчас открыт (в инкогнито — ничего).
 */
object Passwords {

    /** Шифрование списка; в модульных тестах подменяется (Keystore там нет). */
    interface Codec {
        fun encrypt(plain: String): String
        fun decrypt(stored: String): String
    }

    internal var codec: Codec = KeystoreCodec

    /** Профиль открытой вкладки; 0 — инкогнито или браузер не открыт. */
    @Volatile var activeProfile = 0

    // The file is shared by all profiles and password settings.
    private var writeUncertain = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("passwords", Context.MODE_PRIVATE)

    /** Null means unreadable, never an empty authoritative store. */
    @Synchronized internal fun read(ctx: Context, profile: Int): List<Login>? {
        if (writeUncertain) return null
        return runCatching {
            val stored = prefs(ctx).getString("p_$profile", null) ?: return@runCatching emptyList()
            parse(codec.decrypt(stored))
        }.getOrNull()
    }

    fun list(ctx: Context, profile: Int): List<Login> = requireReadable(ctx, profile)

    class Unavailable : IllegalStateException("Password storage unavailable")
    fun requireReadable(ctx: Context, profile: Int): List<Login> = read(ctx, profile) ?: throw Unavailable()

    fun count(ctx: Context, profile: Int) = list(ctx, profile).size

    private fun save(ctx: Context, profile: Int, items: List<Login>) {
        // Do not create a replacement key if encrypted data survives without its original key.
        if (codec === KeystoreCodec && !KeystoreCodec.keyExists() && prefs(ctx).all.keys.any { it.startsWith("p_") }) {
            throw Unavailable()
        }
        val encrypted = codec.encrypt(toJson(items).toString())
        if (!commitSafely { prefs(ctx).edit().putString("p_$profile", encrypted).commit() }) throw Unavailable()
    }

    /** Добавить или обновить: тот же guid или тот же сайт с тем же логином. */
    @Synchronized fun upsert(ctx: Context, profile: Int, origin: String, username: String, password: String, guid: String? = null): Boolean {
        val site = originOf(origin) ?: return false
        val items = read(ctx, profile)?.toMutableList() ?: return false
        val i = items.indexOfFirst { (guid != null && it.guid == guid) || (it.origin == site && it.username == username) }
        val login = Login(if (i >= 0) items[i].guid else guid ?: newGuid(), site, username, password, System.currentTimeMillis())
        if (i >= 0) items[i] = login else items += login
        return runCatching { save(ctx, profile, items) }.isSuccess
    }

    internal enum class InsertResult { ADDED, EXISTS, UNAVAILABLE }

    /** Import never replaces an existing site/login; check and write under the same lock. */
    @Synchronized internal fun insertIfAbsent(ctx: Context, profile: Int, origin: String, username: String, password: String): InsertResult {
        val site = originOf(origin) ?: return InsertResult.UNAVAILABLE
        val items = read(ctx, profile)?.toMutableList() ?: return InsertResult.UNAVAILABLE
        if (items.any { it.origin == site && it.username == username }) return InsertResult.EXISTS
        items += Login(newGuid(), site, username, password, System.currentTimeMillis())
        return if (runCatching { save(ctx, profile, items) }.isSuccess) InsertResult.ADDED else InsertResult.UNAVAILABLE
    }

    /** Удалить пароли, сохранённые или изменённые начиная с [since] (мс); 0 — все. */
    @Synchronized fun removeSince(ctx: Context, profile: Int, since: Long): Boolean {
        val items = read(ctx, profile) ?: return false
        return runCatching { save(ctx, profile, items.filter { since > 0 && it.time < since }) }.isSuccess
    }

    @Synchronized fun remove(ctx: Context, profile: Int, guid: String): Boolean {
        val items = read(ctx, profile) ?: return false
        return runCatching { save(ctx, profile, items.filterNot { it.guid == guid }) }.isSuccess
    }

    /** Пароли профиля для сайта: тот же хост или его поддомен. */
    fun forDomain(ctx: Context, profile: Int, domain: String): List<Login> {
        val d = domain.lowercase().removePrefix("www.")
        return (read(ctx, profile) ?: return emptyList()).filter { login ->
            val host = Uri.parse(login.origin).host.orEmpty().lowercase().removePrefix("www.")
            host == d || host.endsWith(".$d") || d.endsWith(".$host")
        }
    }

    // --- Сайты, где пароли не предлагаем сохранять ---

    @Synchronized internal fun readNever(ctx: Context, profile: Int): Set<String>? {
        if (writeUncertain) return null
        return try {
            val all = prefs(ctx).all
            val name = "never_$profile"
            if (!all.containsKey(name)) emptySet()
            else (all[name] as? Set<*>)?.takeIf { set -> set.all { it is String } }?.filterIsInstance<String>()?.toSet()
        } catch (_: ClassCastException) { null } catch (_: SecurityException) { null }
    }

    // Compatibility helpers are not used by the UI or Gecko when settings are unreadable.
    fun never(ctx: Context, profile: Int): Set<String> = readNever(ctx, profile).orEmpty()

    @Synchronized fun setNever(ctx: Context, profile: Int, host: String, on: Boolean): Boolean {
        val set = readNever(ctx, profile)?.toMutableSet() ?: return false
        if (on) set += host else set -= host
        return commitSafely { prefs(ctx).edit().putStringSet("never_$profile", set).commit() }
    }

    @Synchronized internal fun readOffer(ctx: Context): Boolean? {
        if (writeUncertain) return null
        return try {
            val all = prefs(ctx).all
            if (!all.containsKey("offer")) true else all["offer"] as? Boolean
        } catch (_: ClassCastException) { null } catch (_: SecurityException) { null }
    }

    /** Предлагать сохранять пароли (по умолчанию да). */
    fun offer(ctx: Context) = readOffer(ctx) ?: false

    @Synchronized fun setOffer(ctx: Context, on: Boolean): Boolean {
        if (readOffer(ctx) == null) return false
        return commitSafely { prefs(ctx).edit().putBoolean("offer", on).commit() }
    }

    private fun commitSafely(write: () -> Boolean): Boolean {
        if (writeUncertain) return false
        val ok = runCatching { write() }.getOrDefault(false)
        if (!ok) writeUncertain = true
        return ok
    }

    // --- Для движка ---

    fun storage(ctx: Context) = object : Autocomplete.StorageDelegate {
        override fun onLoginFetch(domain: String): GeckoResult<Array<Autocomplete.LoginEntry>>? {
            val profile = activeProfile
            if (profile == 0) return GeckoResult.fromValue(emptyArray())
            return GeckoResult.fromValue(forDomain(ctx, profile, domain).map { entry(it) }.toTypedArray())
        }

        override fun onLoginSave(login: Autocomplete.LoginEntry) {
            val profile = activeProfile
            val user = login.username ?: ""
            val pass = login.password ?: return
            if (profile != 0 && !upsert(ctx, profile, login.origin, user, pass, login.guid)) {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    android.widget.Toast.makeText(ctx, Tr.t("password_storage_unavailable"), android.widget.Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    fun entry(l: Login): Autocomplete.LoginEntry = Autocomplete.LoginEntry.Builder()
        .guid(l.guid).origin(l.origin).formActionOrigin(l.origin).username(l.username).password(l.password).build()

    // --- Вспомогательное (используется и резервной копией) ---

    fun originOf(url: String): String? {
        val u = Uri.parse(url.trim())
        val host = u.host?.lowercase() ?: return null
        val scheme = u.scheme?.lowercase()?.takeIf { it == "http" || it == "https" } ?: "https"
        val port = if (u.port > 0) ":${u.port}" else ""
        return "$scheme://$host$port"
    }

    private var seq = 0L
    private fun newGuid(): String {
        val now = System.currentTimeMillis()
        seq = if (now > seq) now else seq + 1
        return "os-$seq"
    }

    fun toJson(items: List<Login>) = JSONArray().apply {
        items.forEach { put(JSONObject().put("g", it.guid).put("o", it.origin).put("u", it.username).put("p", it.password).put("t", it.time)) }
    }

    fun parse(json: String): List<Login> {
        val arr = JSONArray(json)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            Login(o.getString("g"), o.getString("o"), o.optString("u"), o.getString("p"), o.optLong("t"))
        }
    }

    /** Ключ AES-256 в Android Keystore; шифротекст хранится как base64(iv + данные). */
    private object KeystoreCodec : Codec {
        private const val ALIAS = "os_passwords"

        fun keyExists(): Boolean = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(ALIAS)

        private fun key(create: Boolean): SecretKey {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            if (!create || ks.containsAlias(ALIAS)) throw IllegalStateException("Password key unavailable")
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build())
            }.generateKey()
        }

        override fun encrypt(plain: String): String {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key(create = true)) }
            return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        }

        override fun decrypt(stored: String): String {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, raw, 0, 12))
            return String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        }
    }
}
