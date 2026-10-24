package ru.multibrowser

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.Window
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Меню браузера ⋮ — нижний лист: сверху ряд частых действий крупными иконками, ниже разделы
 * («Вкладки», «Страница», «Библиотека», «Ось») — строки с иконкой, как в Chrome/Opera.
 */
class BrowserMenu(private val a: Activity) {

    class Item(val icon: Int, val title: String, val action: () -> Unit)
    class Section(val title: String, val items: List<Item>)

    fun show(quick: List<Item>, sections: List<Section>) {
        val dialog = Dialog(a)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        fun run(item: Item) {
            dialog.dismiss()
            item.action()
        }

        val content = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(a.dp(8), a.dp(8), a.dp(8), a.dp(12))
        }
        // Ручка листа.
        content.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER
            addView(android.view.View(a).apply { background = Ui.rounded(Ui.BORDER, a.dpf(2)) },
                LinearLayout.LayoutParams(a.dp(36), a.dp(4)))
            setPadding(0, 0, 0, a.dp(8))
        })

        // Частые действия: иконка в круге и короткая подпись.
        content.addView(LinearLayout(a).apply {
            quick.forEach { item ->
                addView(LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    setPadding(a.dp(2), a.dp(6), a.dp(2), a.dp(6))
                    background = ripple()
                    contentDescription = item.title
                    setOnClickListener { run(item) }
                    addView(LinearLayout(a).apply {
                        gravity = Gravity.CENTER
                        background = Ui.oval(Ui.BG, a.dp(1), Ui.BORDER)
                        addView(a.icon(item.icon, Ui.TEXT, 22))
                    }, LinearLayout.LayoutParams(a.dp(44), a.dp(44)))
                    addView(TextView(a).apply {
                        text = item.title
                        textSize = 11f
                        gravity = Gravity.CENTER
                        maxLines = 2
                        ellipsize = TextUtils.TruncateAt.END
                        setTextColor(Ui.MUTED)
                        setPadding(0, a.dp(4), 0, 0)
                    })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
        })

        sections.filter { it.items.isNotEmpty() }.forEach { section ->
            content.addView(android.view.View(a).apply { setBackgroundColor(Ui.BORDER) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, a.dp(1)).apply {
                    topMargin = a.dp(8); bottomMargin = a.dp(4)
                })
            content.addView(TextView(a).apply {
                text = section.title.uppercase()
                textSize = 11f
                typeface = Typeface.DEFAULT_BOLD
                letterSpacing = 0.06f
                setTextColor(Ui.MUTED)
                setPadding(a.dp(12), a.dp(6), a.dp(12), a.dp(4))
            })
            section.items.forEach { item ->
                content.addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(a.dp(12), 0, a.dp(12), 0)
                    background = ripple()
                    setOnClickListener { run(item) }
                    addView(a.icon(item.icon, Ui.MUTED, 20))
                    addView(TextView(a).apply {
                        text = item.title
                        textSize = 15f
                        setTextColor(Ui.TEXT)
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                        setPadding(a.dp(16), 0, 0, 0)
                    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, a.dp(46)))
            }
        }

        val sheet = ScrollView(a).apply {
            isVerticalScrollBarEnabled = false
            background = GradientDrawable().apply {
                setColor(Ui.SURFACE)
                val r = a.dpf(16)
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            addView(content)
        }
        sheet.layoutDirection = a.window.decorView.layoutDirection
        dialog.setContentView(sheet)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setGravity(Gravity.BOTTOM)
            // Не выше 85% экрана — дальше лист прокручивается.
            val maxH = (a.resources.displayMetrics.heightPixels * 0.85f).toInt()
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            sheet.post {
                if (sheet.height > maxH) setLayout(ViewGroup.LayoutParams.MATCH_PARENT, maxH)
            }
        }
        dialog.show()
    }

    private fun ripple() = TypedValue().let { tv ->
        a.theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        androidx.core.content.ContextCompat.getDrawable(a, tv.resourceId)
    }
}
