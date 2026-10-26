package ru.multibrowser

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.mozilla.geckoview.GeckoSession.ContentDelegate.ContextElement

/**
 * Меню долгого нажатия на ссылку, картинку, видео или аудио — как в Chrome: карточка по центру,
 * сверху буква сайта, текст и адрес ссылки, ниже пункты группами, разделёнными линией.
 */
class LinkMenu(private val a: Activity) {

    class Item(val icon: Int, val title: String, val action: () -> Unit)

    /** Что показать в шапке и какие пункты: собирается из [ContextElement] (см. [Target.of]). */
    data class Target(
        val link: String?, // адрес ссылки (только http/https/mailto/tel — остальное не показываем)
        val linkText: String?, // текст ссылки
        val media: String?, // адрес картинки/видео/аудио (только http/https)
        val type: Int, // ContextElement.TYPE_*
        val title: String?, // всплывающая подсказка или alt
    ) {
        val webLink get() = link?.let { isWeb(it) } == true
        val hasMedia get() = media != null && type != ContextElement.TYPE_NONE

        companion object {
            fun isWeb(url: String) = url.startsWith("http://", true) || url.startsWith("https://", true)

            private fun linkOk(url: String?) = url != null &&
                (isWeb(url) || url.startsWith("mailto:", true) || url.startsWith("tel:", true))

            /** Чистые данные из элемента; null — меню не нужно (например, ссылка javascript:). */
            fun of(e: ContextElement): Target? = from(e.linkUri, e.linkText, e.srcUri, e.type, e.title ?: e.altText)

            fun from(linkUri: String?, text: String?, src: String?, type: Int, title: String?): Target? {
                val link = linkUri?.trim()?.takeIf { linkOk(it) }
                val media = src?.trim()?.takeIf { isWeb(it) && type != ContextElement.TYPE_NONE }
                if (link == null && media == null) return null
                val clean = text?.replace(Regex("\\s+"), " ")?.trim()?.takeIf { it.isNotEmpty() }
                return Target(link, clean, media, if (media == null) ContextElement.TYPE_NONE else type,
                    title?.trim()?.takeIf { it.isNotEmpty() })
            }
        }
    }

    fun show(t: Target, groups: List<List<Item>>) {
        val dialog = Dialog(a)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val content = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        content.addView(header(t))
        groups.filter { it.isNotEmpty() }.forEach { group ->
            content.addView(View(a).apply { setBackgroundColor(Ui.BORDER) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, a.dp(1)).apply {
                    bottomMargin = a.dp(4); topMargin = a.dp(if (content.childCount == 1) 0 else 4)
                })
            group.forEach { item ->
                content.addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(a.dp(20), 0, a.dp(16), 0)
                    background = ripple()
                    contentDescription = item.title
                    setOnClickListener { dialog.dismiss(); item.action() }
                    addView(a.icon(item.icon, Ui.MUTED, 20))
                    addView(TextView(a).apply {
                        text = item.title
                        textSize = 16f
                        setTextColor(Ui.TEXT)
                        maxLines = 2
                        ellipsize = TextUtils.TruncateAt.END
                        setPadding(a.dp(18), 0, 0, 0)
                    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, a.dp(52)))
            }
        }
        content.setPadding(0, 0, 0, a.dp(6))
        val sheet = ScrollView(a).apply {
            isVerticalScrollBarEnabled = false
            background = Ui.rounded(Ui.SURFACE, a.dpf(20))
            elevation = a.dpf(12)
            addView(content)
        }
        sheet.layoutDirection = a.window.decorView.layoutDirection
        dialog.setContentView(sheet)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setDimAmount(0.45f)
            setGravity(Gravity.CENTER)
            val dm = a.resources.displayMetrics
            val width = minOf(a.dp(360), dm.widthPixels - a.dp(32))
            setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT)
            val maxH = dm.heightPixels - a.dp(96)
            sheet.post { if (sheet.height > maxH) setLayout(width, maxH) }
        }
        dialog.show()
    }

    /** Шапка: кружок с первой буквой сайта, ниже — текст и адрес (ссылки или картинки). */
    private fun header(t: Target) = LinearLayout(a).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(a.dp(20), a.dp(18), a.dp(20), a.dp(16))
        val url = t.link ?: t.media.orEmpty()
        val host = Uri.parse(url).host?.removePrefix("www.").orEmpty()
        addView(TextView(a).apply {
            text = (host.firstOrNull() ?: '•').uppercase()
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Ui.TEXT)
            background = Ui.oval(Ui.BG)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(a.dp(44), a.dp(44)))
        addView(LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(a.dp(16), 0, 0, 0)
            val title = t.linkText ?: t.title
            if (title != null) addView(TextView(a).apply {
                text = title
                textSize = 15f
                setTextColor(Ui.TEXT)
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
            })
            addView(TextView(a).apply {
                text = url.removePrefix("https://").removePrefix("http://")
                textSize = 13f
                setTextColor(Ui.MUTED)
                maxLines = if (title == null) 3 else 1
                ellipsize = TextUtils.TruncateAt.END
                textDirection = View.TEXT_DIRECTION_LTR
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun ripple() = TypedValue().let { tv ->
        a.theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        androidx.core.content.ContextCompat.getDrawable(a, tv.resourceId)
    }
}
