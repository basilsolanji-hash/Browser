package ru.multibrowser

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.EditText
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Экран «Заметки» (№37): локальные заметки, в том числе из выделенного на страницах текста. */
class NotesActivity : AppCompatActivity() {

    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        list = ExtrasUi.screen(this)
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    private fun render() {
        list.removeAllViews()
        list.addView(ExtrasUi.header(this, Tr.t("notes"),
            ExtrasUi.headerAction(this, "+", Tr.t("new_note")) { editDialog(null) }))
        list.addView(ExtrasUi.hint(this, Tr.t("notes_local")))
        val notes = Notes.list(this)
        if (notes.isEmpty()) {
            list.addView(ExtrasUi.empty(this, Tr.t("notes_empty")))
            return
        }
        val fmt = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
        notes.forEach { n ->
            val source = Uri.parse(n.url).host
            val sub = listOfNotNull(source, fmt.format(Date(n.time))).joinToString(" · ")
            list.addView(ExtrasUi.card(this, n.text, sub, onMenu = { noteMenu(n) }) { editDialog(n) })
        }
    }

    private fun noteMenu(n: Note) {
        val actions = mutableListOf<Pair<String, () -> Unit>>(
            Tr.t("copy") to { copyText("note", n.text) },
            Tr.t("share") to {
                runCatching {
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, if (n.url.isBlank()) n.text else "${n.text}\n\n${n.url}")
                    }, Tr.t("share")))
                }
            },
        )
        if (n.url.startsWith("http")) actions += Tr.t("open_source") to {
            startActivity(Intent(this, BrowserActivity::class.java).putExtra(BrowserActivity.EXTRA_URL, n.url))
        }
        actions += Tr.t("delete") to {
            AlertDialog.Builder(this)
                .setTitle(Tr.t("delete_note_q"))
                .setPositiveButton(Tr.t("delete")) { _, _ -> Notes.remove(this, n.id); render() }
                .setNegativeButton(Tr.t("cancel"), null)
                .show()
        }
        AlertDialog.Builder(this)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun editDialog(n: Note?) {
        val input = EditText(this).apply {
            setText(n?.text ?: "")
            hint = Tr.t("note_hint")
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 3
            maxLines = 12
            gravity = Gravity.TOP or Gravity.START
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
        }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(this)
            .setTitle(if (n == null) Tr.t("new_note") else Tr.t("notes"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                val text = input.text.toString()
                if (n == null) Notes.add(this, text) else Notes.update(this, n.id, text)
                render()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }
}
