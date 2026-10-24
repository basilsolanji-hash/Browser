package ru.multibrowser

import android.app.Activity
import android.content.Context
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Общие элементы экранов блоков D/E/F (заметки, сохранённые страницы, «О приложении», справка). */
object ExtrasUi {

    /** Прокручиваемый экран с полями как у настроек; возвращает контейнер для содержимого. */
    fun screen(a: Activity): LinearLayout {
        val content = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(a.dp(16), a.dp(12), a.dp(16), a.dp(32))
        }
        val root = ScrollView(a).apply {
            setBackgroundColor(Ui.BG)
            isFillViewport = true
            addView(content)
        }
        a.setContentView(root)
        a.applyEdgeToEdge(root)
        return content
    }

    /** Шапка: «назад», заголовок и необязательная кнопка справа. */
    fun header(a: Activity, title: String, action: View? = null) = LinearLayout(a).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(a.iconButton(R.drawable.ic_back, Tr.t("back")) { a.finish() },
            LinearLayout.LayoutParams(a.dp(40), a.dp(40)))
        addView(TextView(a).apply {
            text = title
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(a.dp(8), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        action?.let { addView(it, LinearLayout.LayoutParams(a.dp(40), a.dp(40))) }
    }

    /** Текстовая кнопка-действие в шапке (например, «+»). */
    fun headerAction(ctx: Context, symbol: String, description: String, onClick: () -> Unit) = TextView(ctx).apply {
        text = symbol
        textSize = 22f
        gravity = Gravity.CENTER
        setTextColor(Ui.TEXT)
        contentDescription = description
        background = Ui.rounded(Ui.SURFACE, ctx.dpf(6), ctx.dp(1))
        setOnClickListener { onClick() }
    }

    fun hint(ctx: Context, text: String) = TextView(ctx).apply {
        this.text = text
        textSize = 12f
        setTextColor(Ui.MUTED)
        setPadding(0, ctx.dp(6), 0, 0)
    }

    fun empty(ctx: Context, text: String) = TextView(ctx).apply {
        this.text = text
        textSize = 14f
        setTextColor(Ui.MUTED)
        setPadding(ctx.dp(8), ctx.dp(32), ctx.dp(8), 0)
        gravity = Gravity.CENTER_HORIZONTAL
    }

    fun button(ctx: Context, label: String, onClick: () -> Unit) = TextView(ctx).apply {
        text = label
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(Ui.TEXT)
        setPadding(ctx.dp(12), 0, ctx.dp(12), 0)
        background = Ui.rounded(Ui.SURFACE, ctx.dpf(6), ctx.dp(1))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ctx.dp(44))
            .apply { topMargin = ctx.dp(8) }
        setOnClickListener { onClick() }
    }

    /** Карточка: жирный заголовок и подпись; по нажатию — действие; справа — «⋮» (или [menuSymbol]), если задано меню. */
    fun card(
        ctx: Context, title: String, subtitle: String?, onMenu: (() -> Unit)? = null,
        menuSymbol: String = "⋮", menuDescription: String = Tr.t("menu"), onClick: (() -> Unit)? = null,
    ): View {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, ctx.dpf(6), ctx.dp(1))
            setPadding(ctx.dp(14), ctx.dp(10), ctx.dp(6), ctx.dp(10))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = ctx.dp(8) }
            onClick?.let { c -> setOnClickListener { c() } }
        }
        row.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(ctx).apply {
                text = title
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                maxLines = 4
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            if (!subtitle.isNullOrBlank()) addView(TextView(ctx).apply {
                text = subtitle
                textSize = 12f
                setTextColor(Ui.MUTED)
                setPadding(0, ctx.dp(2), 0, 0)
                maxLines = 3
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        onMenu?.let { m ->
            row.addView(TextView(ctx).apply {
                text = menuSymbol
                textSize = 20f
                gravity = Gravity.CENTER
                setTextColor(Ui.MUTED)
                contentDescription = menuDescription
                setOnClickListener { m() }
            }, LinearLayout.LayoutParams(ctx.dp(40), ctx.dp(40)))
        }
        return row
    }

    /** Сегментированный переключатель в стиле настроек. */
    fun <T> segmented(ctx: Context, options: List<T>, current: T, label: (T) -> String, onPick: (T) -> Unit): View {
        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Ui.rounded(Ui.SURFACE, ctx.dpf(6), ctx.dp(1))
            setPadding(ctx.dp(3), ctx.dp(3), ctx.dp(3), ctx.dp(3))
        }
        options.forEach { option ->
            val selected = option == current
            bar.addView(TextView(ctx).apply {
                text = label(option)
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                maxLines = 2
                minHeight = ctx.dp(40)
                setPadding(ctx.dp(4), ctx.dp(4), ctx.dp(4), ctx.dp(4))
                background = if (selected) Ui.rounded(Ui.ACCENT, ctx.dpf(5)) else null
                setTextColor(if (selected) Ui.ON_ACCENT else Ui.MUTED)
                setOnClickListener { onPick(option) }
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                gravity = Gravity.CENTER_VERTICAL
            })
        }
        return bar
    }

    /** Обычный абзац текста. */
    fun paragraph(ctx: Context, text: String, size: Float = 14f, color: Int = Ui.TEXT, bold: Boolean = false) = TextView(ctx).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setLineSpacing(0f, 1.2f)
        setPadding(0, ctx.dp(4), 0, ctx.dp(4))
    }
}
