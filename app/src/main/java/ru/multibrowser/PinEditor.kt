package ru.multibrowser

import android.app.Activity
import android.graphics.Typeface
import android.view.Gravity
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog

/**
 * Редактор закреплённых вкладок: список со стрелками порядка и удалением, «Добавить вкладку».
 * @param profile null — общий набор (настройки), иначе — свой набор профиля (экран профиля).
 */
class PinEditor(private val a: Activity, private val profile: Int?, private val onChange: () -> Unit = {}) {

    val view = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
    private val rows = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }

    init {
        view.addView(rows)
        view.addView(ExtrasUi.button(a, Tr.t("add_tab")) { editDialog(null) })
        render()
    }

    fun render() {
        rows.removeAllViews()
        val list = Pins.all(a, profile)
        list.forEachIndexed { index, pin ->
            val row = LinearLayout(a).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, a.dpf(6), a.dp(1))
                setPadding(a.dp(12), a.dp(6), a.dp(6), a.dp(6))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = a.dp(6) }
                setOnClickListener { editDialog(pin) }
            }
            row.addView(LinearLayout(a).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(a).apply {
                    text = pin.title
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Ui.TEXT)
                    maxLines = 1
                })
                addView(TextView(a).apply {
                    text = if (pin.url == Pins.START) Tr.t("start_page") else pin.url
                    textSize = 12f
                    setTextColor(Ui.MUTED)
                    maxLines = 1
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            // Стрелки порядка и удаление.
            row.addView(arrow("↑", index > 0) { Pins.move(a, pin.id, -1, profile); changed() })
            row.addView(arrow("↓", index < list.size - 1) { Pins.move(a, pin.id, 1, profile); changed() })
            row.addView(arrow("✕", list.size > 1) { Pins.remove(a, pin.id, profile); changed() })
            rows.addView(row)
        }
    }

    private fun changed() {
        render()
        onChange()
    }

    private fun arrow(symbol: String, enabled: Boolean, onClick: () -> Unit) = TextView(a).apply {
        text = symbol
        textSize = 18f
        gravity = Gravity.CENTER
        setTextColor(if (enabled) Ui.TEXT else Ui.MUTED)
        alpha = if (enabled) 1f else 0.3f
        layoutParams = LinearLayout.LayoutParams(a.dp(40), a.dp(40))
        isEnabled = enabled
        if (enabled) setOnClickListener { onClick() }
    }

    private fun editDialog(pin: Pin?) {
        val title = EditText(a).apply {
            hint = Tr.t("tab_name_hint")
            setText(pin?.title ?: "")
            setSingleLine()
            setTextColor(Ui.TEXT)
        }
        val url = EditText(a).apply {
            hint = Tr.t("tab_url_hint")
            setText(pin?.url ?: "https://")
            setSingleLine()
            setTextColor(Ui.TEXT)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
        }
        val box = LinearLayout(a).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(a.dp(20), a.dp(8), a.dp(20), 0)
            addView(title)
            addView(url, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = a.dp(8) })
        }
        AlertDialog.Builder(a)
            .setTitle(if (pin == null) Tr.t("new_tab") else Tr.t("edit_tab"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                val t = title.text.toString().ifBlank { Tr.t("tab_fallback") }
                val u = url.text.toString()
                if (pin == null) Pins.add(a, t, u, profile) else Pins.update(a, pin.id, t, u, profile)
                changed()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }
}
