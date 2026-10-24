package ru.multibrowser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Закреплённая вкладка: стабильный id (для хранения сессии), название и адрес. Настраивается пользователем. */
data class Pin(val id: String, val title: String, val url: String)

/**
 * Список закреплённых вкладок — общий для всех профилей. В каждом профиле у вкладки свой вход и cookies.
 * По умолчанию Gmail и Claude, но пользователь может переименовать, изменить адрес, добавить и удалить.
 */
object Pins {
    /** Нейтральная стартовая страница — база универсального браузера (без привязки к сервисам). */
    const val START = "data:text/html;charset=utf-8,%3C%21doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Cmeta%20name%3D%22viewport%22%20content%3D%22width%3Ddevice-width%2Cinitial-scale%3D1%22%3E%3Cstyle%3E%0Ahtml%2Cbody%7Bheight%3A100%25%3Bmargin%3A0%7Dbody%7Bdisplay%3Aflex%3Bflex-direction%3Acolumn%3Balign-items%3Acenter%3Bjustify-content%3Acenter%3B%0Afont-family%3Asystem-ui%2Csans-serif%3Bbackground%3A%2317181B%3Bcolor%3A%23ECEDEF%3Btext-align%3Acenter%3Bpadding%3A24px%7D%0A.ring%7Bwidth%3A70px%3Bheight%3A70px%3Bborder%3A9px%20solid%20%23ECEDEF%3Bborder-radius%3A50%25%3Bposition%3Arelative%3Bmargin-bottom%3A8px%7D%0A.axis%7Bposition%3Aabsolute%3Btop%3A50%25%3Bleft%3A-34px%3Bwidth%3A150px%3Bheight%3A8px%3Bbackground%3A%23F0453A%3Btransform%3AtranslateY%28-50%25%29%7D%0A.dot%7Bposition%3Aabsolute%3Btop%3A50%25%3Bleft%3A-44px%3Bwidth%3A18px%3Bheight%3A18px%3Bborder-radius%3A50%25%3Bbackground%3A%23F0453A%3Btransform%3AtranslateY%28-50%25%29%7D%0Ah1%7Bfont-size%3A22px%3Bmargin%3A14px%200%204px%7D.t%7Bcolor%3A%23F0453A%7D.b%7Bcolor%3A%239BA0A8%3Bfont-size%3A12px%3Bletter-spacing%3A.14em%3Btext-transform%3Auppercase%3Bmargin%3A0%200%2010px%7D%0Ap%7Bcolor%3A%239BA0A8%3Bfont-size%3A14px%3Bmax-width%3A320px%3Bline-height%3A1.5%7D%3C/style%3E%3C/head%3E%0A%3Cbody%3E%3Cdiv%20class%3D%22ring%22%3E%3Cdiv%20class%3D%22axis%22%3E%3C/div%3E%3Cdiv%20class%3D%22dot%22%3E%3C/div%3E%3C/div%3E%0A%3Ch1%3E%D0%9E%D1%81%D1%8C%3Cspan%20class%3D%22t%22%3EBrowser%3C/span%3E%3C/h1%3E%0A%3Cp%20class%3D%22b%22%3EBusiness%20browser%3C/p%3E%0A%3Cp%3EPrivacy%20first.%20Type%20an%20address%20or%20search%20above.%20Add%20pinned%20tabs%20in%20settings.%3C/p%3E%3C/body%3E%3C/html%3E"

    private val DEFAULT = listOf(Pin("start", "Старт", START))


    private fun prefs(ctx: Context) = ctx.getSharedPreferences("pins", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<Pin> {
        val raw = prefs(ctx).getString("list", null)
        val list = if (raw == null) DEFAULT else runCatching {
            val arr = JSONArray(raw)
            (0 until arr.length()).map {
                val o = arr.getJSONObject(it)
                Pin(o.getString("id"), o.getString("title"), o.getString("url"))
            }
        }.getOrDefault(DEFAULT).ifEmpty { DEFAULT }
        // Название встроенной стартовой вкладки показываем на языке интерфейса.
        return list.map { if (it.url == START) it.copy(title = Tr.t("start")) else it }
    }

    fun byId(ctx: Context, id: String?): Pin? = all(ctx).firstOrNull { it.id == id }

    /** Вкладка по id, а если такой больше нет (удалили) — первая закреплённая. */
    fun resolve(ctx: Context, id: String?): Pin = byId(ctx, id) ?: all(ctx).first()

    fun save(ctx: Context, pins: List<Pin>) {
        val arr = JSONArray()
        pins.forEach { arr.put(JSONObject().put("id", it.id).put("title", it.title).put("url", it.url)) }
        prefs(ctx).edit().putString("list", arr.toString()).apply()
    }

    fun add(ctx: Context, title: String, url: String) {
        val pin = Pin("p" + System.currentTimeMillis(), title.trim(), normalize(url))
        save(ctx, all(ctx) + pin)
    }

    fun update(ctx: Context, id: String, title: String, url: String) {
        save(ctx, all(ctx).map { if (it.id == id) it.copy(title = title.trim(), url = normalize(url)) else it })
    }

    fun remove(ctx: Context, id: String) {
        val left = all(ctx).filterNot { it.id == id }
        save(ctx, left.ifEmpty { DEFAULT })
    }

    fun move(ctx: Context, id: String, delta: Int) {
        val list = all(ctx).toMutableList()
        val i = list.indexOfFirst { it.id == id }
        val j = i + delta
        if (i in list.indices && j in list.indices) {
            list.add(j, list.removeAt(i))
            save(ctx, list)
        }
    }

    private fun normalize(url: String): String {
        val t = url.trim()
        return when {
            t.isEmpty() -> "about:blank"
            t.startsWith("http://") || t.startsWith("https://") -> t
            else -> "https://$t"
        }
    }
}
