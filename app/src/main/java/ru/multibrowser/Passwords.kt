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

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("passwords", Context.MODE_PRIVATE)

    fun list(ctx: Context, profile: Int): List<Login> {
        val stored = prefs(ctx).getString("p_$profile", null) ?: return emptyList()
        return runCatching { parse(codec.decrypt(stored)) }.getOrDefault(emptyList())
    }

    fun count(ctx: Context, profile: Int) = list(ctx, profile).size

    private fun save(ctx: Context, profile: Int, items: List<Login>) {
        prefs(ctx).edit().putString("p_$profile", codec.encrypt(toJson(items).toString())).apply()
    }

    /** Добавить или обновить: тот же guid или тот же сайт с тем же логином. */
    fun upsert(ctx: Context, profile: Int, origin: String, username: String, password: String, guid: String? = null) {
        val site = originOf(origin) ?: return
        val items = list(ctx, profile).toMutableList()
        val i = items.indexOfFirst { (guid != null && it.guid == guid) || (it.origin == site && it.username == username) }
        val login = Login(if (i >= 0) items[i].guid else guid ?: newGuid(), site, username, password, System.currentTimeMillis())
        if (i >= 0) items[i] = login else items += login
        save(ctx, profile, items)
    }

    fun remove(ctx: Context, profile: Int, guid: String) = save(ctx, profile, list(ctx, profile).filterNot { it.guid == guid })

    /** Пароли профиля для сайта: тот же хост или его поддомен. */
    fun forDomain(ctx: Context, profile: Int, domain: String): List<Login> {
        val d = domain.lowercase().removePrefix("www.")
        return list(ctx, profile).filter { login ->
            val host = Uri.parse(login.origin).host.orEmpty().lowercase().removePrefix("www.")
            host == d || host.endsWith(".$d") || d.endsWith(".$host")
        }
    }

    // --- Сайты, где пароли не предлагаем сохранять ---

    fun never(ctx: Context, profile: Int): Set<String> =
        prefs(ctx).getStringSet("never_$profile", emptySet()).orEmpty()

    fun setNever(ctx: Context, profile: Int, host: String, on: Boolean) {
        val set = never(ctx, profile).toMutableSet()
        if (on) set += host else set -= host
        prefs(ctx).edit().putStringSet("never_$profile", set).apply()
    }

    /** Предлагать сохранять пароли (по умолчанию да). */
    fun offer(ctx: Context) = prefs(ctx).getBoolean("offer", true)

    fun setOffer(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("offer", on).apply()

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
            if (profile != 0) upsert(ctx, profile, login.origin, user, pass, login.guid)
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

        private fun key(): SecretKey {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build())
            }.generateKey()
        }

        override fun encrypt(plain: String): String {
            val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            return Base64.encodeToString(c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        }

        override fun decrypt(stored: String): String {
            val raw = Base64.decode(stored, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
            return String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        }
    }
}
