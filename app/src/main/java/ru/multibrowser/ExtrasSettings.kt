package ru.multibrowser

import android.content.Intent
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

/**
 * Разделы настроек блоков D/E: главная страница (№27), браузер по умолчанию (№26),
 * заметки и сохранённые страницы, «О приложении» (№23), «Справка и отзывы» (№25).
 * SettingsActivity подключает их одной строкой.
 */
object ExtrasSettings {

    fun addTo(a: AppCompatActivity, content: LinearLayout) {
        content.addView(a.sectionTitle(Tr.t("home_page")))
        val homeBox = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL }
        content.addView(homeBox)
        renderHome(a, homeBox)

        content.addView(a.sectionTitle(Tr.t("default_browser")))
        val status = ExtrasUi.paragraph(a, "", 14f)
        val makeDefault = ExtrasUi.button(a, Tr.t("default_make")) { DefaultBrowser.request(a) }
        content.addView(status)
        content.addView(makeDefault)
        content.addView(ExtrasUi.hint(a, Tr.t("default_desc")))
        fun refresh() {
            val yes = DefaultBrowser.isDefault(a)
            status.text = Tr.t(if (yes) "default_is" else "default_not")
            status.setTextColor(if (yes) Ui.ACCENT else Ui.TEXT)
            makeDefault.text = Tr.t(if (yes) "default_change" else "default_make")
        }
        refresh()
        // После системного диалога выбора возвращаемся сюда — обновляем статус.
        a.lifecycle.addObserver(LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) refresh() })

        content.addView(a.sectionTitle(Tr.t("my_library")))
        content.addView(ExtrasUi.button(a, Tr.t("notes")) { a.startActivity(Intent(a, NotesActivity::class.java)) })
        content.addView(ExtrasUi.button(a, Tr.t("saved_pages")) { a.startActivity(Intent(a, SavedPagesActivity::class.java)) })
        content.addView(ExtrasUi.button(a, Tr.t("stats")) { a.startActivity(Intent(a, StatsActivity::class.java)) })

        content.addView(a.sectionTitle(Tr.t("about_section")))
        content.addView(ExtrasUi.button(a, Tr.t("help_feedback")) { a.startActivity(Intent(a, HelpActivity::class.java)) })
        content.addView(ExtrasUi.button(a, Tr.t("about")) { a.startActivity(Intent(a, AboutActivity::class.java)) })
    }

    private fun renderHome(a: AppCompatActivity, box: LinearLayout) {
        box.removeAllViews()
        val mode = Home.mode(a)
        box.addView(ExtrasUi.segmented(a, Home.Mode.values().toList(), mode, {
            when (it) {
                Home.Mode.OS -> Tr.t("home_os")
                Home.Mode.BLANK -> Tr.t("home_blank")
                Home.Mode.CUSTOM -> Tr.t("home_custom")
            }
        }) { picked ->
            if (picked == Home.Mode.CUSTOM) urlDialog(a) { renderHome(a, box) }
            else { Home.set(a, picked); renderHome(a, box) }
        })
        if (mode == Home.Mode.CUSTOM) {
            box.addView(ExtrasUi.button(a, Home.customUrl(a)) { urlDialog(a) { renderHome(a, box) } })
        }
        box.addView(ExtrasUi.hint(a, Tr.t("home_desc")))
    }

    private fun urlDialog(a: AppCompatActivity, done: () -> Unit) {
        val input = EditText(a).apply {
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = Tr.t("home_url_hint")
            setText(Home.customUrl(a))
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
        }
        val box = LinearLayout(a).apply {
            setPadding(a.dp(20), a.dp(8), a.dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(a)
            .setTitle(Tr.t("home_custom"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                val url = Home.normalize(input.text.toString())
                if (url.isNotEmpty()) Home.set(a, Home.Mode.CUSTOM, url)
                done()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }
}
