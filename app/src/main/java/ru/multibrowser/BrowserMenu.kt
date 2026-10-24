package ru.multibrowser

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.CheckBox
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Меню браузера ⋮ — как в Chrome: карточка у правого верхнего угла, сверху ряд круглых кнопок
 * (назад, вперёд, избранное, сохранить, обновить), ниже группы пунктов с иконками, разделённые линией.
 */
class BrowserMenu(private val a: Activity) {

    /** [checked] не null — пункт с галочкой справа (например, «Версия для ПК»). */
    class Item(
        val icon: Int, val title: String, val enabled: Boolean = true,
        val checked: Boolean? = null, val action: () -> Unit,
    )

    fun show(top: List<Item>, groups: List<List<Item>>) {
        val dialog = Dialog(a)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        fun run(item: Item) {
            dialog.dismiss()
            item.action()
        }

        val content = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, a.dp(12), 0, a.dp(8))
        }
        // Ряд круглых кнопок: только иконки, подпись — для озвучки.
        content.addView(LinearLayout(a).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(a.dp(12), 0, a.dp(12), a.dp(8))
            top.forEach { item ->
                addView(FrameLayout(a).apply {
                    addView(FrameLayout(a).apply {
                        background = Ui.oval(Ui.BG)
                        alpha = if (item.enabled) 1f else 0.35f
                        contentDescription = item.title
                        isEnabled = item.enabled
                        if (item.enabled) setOnClickListener { run(item) }
                        addView(a.icon(item.icon, Ui.TEXT, 22), FrameLayout.LayoutParams(a.dp(22), a.dp(22), Gravity.CENTER))
                    }, FrameLayout.LayoutParams(a.dp(46), a.dp(46), Gravity.CENTER))
                }, LinearLayout.LayoutParams(0, a.dp(52), 1f))
            }
        })

        groups.filter { it.isNotEmpty() }.forEachIndexed { gi, group ->
            if (gi > 0) content.addView(View(a).apply { setBackgroundColor(Ui.BORDER) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, a.dp(1)).apply {
                    marginStart = a.dp(16); marginEnd = a.dp(16); topMargin = a.dp(4); bottomMargin = a.dp(4)
                })
            group.forEach { item ->
                content.addView(LinearLayout(a).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(a.dp(18), 0, a.dp(14), 0)
                    background = ripple()
                    alpha = if (item.enabled) 1f else 0.4f
                    if (item.enabled) setOnClickListener { run(item) }
                    addView(a.icon(item.icon, Ui.TEXT, 22))
                    addView(TextView(a).apply {
                        text = item.title
                        textSize = 16f
                        setTextColor(Ui.TEXT)
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                        setPadding(a.dp(20), 0, a.dp(8), 0)
                    }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                    item.checked?.let { on ->
                        addView(CheckBox(a).apply {
                            isChecked = on
                            isClickable = false
                            isFocusable = false
                            buttonTintList = android.content.res.ColorStateList.valueOf(if (on) Ui.ACCENT else Ui.MUTED)
                        })
                    }
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, a.dp(52)))
            }
        }

        val sheet = ScrollView(a).apply {
            isVerticalScrollBarEnabled = false
            background = Ui.rounded(Ui.SURFACE, a.dpf(18))
            elevation = a.dpf(12)
            addView(content)
        }
        sheet.layoutDirection = a.window.decorView.layoutDirection
        dialog.setContentView(sheet)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setDimAmount(0.25f)
            setGravity(Gravity.TOP or Gravity.END)
            val dm = a.resources.displayMetrics
            val width = minOf(a.dp(340), dm.widthPixels - a.dp(16))
            attributes = attributes.apply { x = a.dp(8); y = a.dp(8) }
            setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT)
            // Не выше экрана — дальше меню прокручивается.
            val maxH = dm.heightPixels - a.dp(48)
            sheet.post { if (sheet.height > maxH) setLayout(width, maxH) }
        }
        dialog.show()
    }

    private fun ripple() = TypedValue().let { tv ->
        a.theme.resolveAttribute(android.R.attr.selectableItemBackground, tv, true)
        androidx.core.content.ContextCompat.getDrawable(a, tv.resourceId)
    }
}
