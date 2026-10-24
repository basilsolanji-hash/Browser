package ru.multibrowser

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.format.Formatter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Экран «Сохранённые страницы» (№35): чтение офлайн, отправка, переименование, удаление. */
class SavedPagesActivity : AppCompatActivity() {

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
        list.addView(ExtrasUi.header(this, Tr.t("saved_pages")))
        val pages = SavedPages.list(this)
        if (pages.isEmpty()) {
            list.addView(ExtrasUi.empty(this, Tr.t("saved_empty")))
            return
        }
        val fmt = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
        pages.forEach { p ->
            val sub = listOfNotNull(Uri.parse(p.url).host, fmt.format(Date(p.time)),
                Formatter.formatShortFileSize(this, p.size)).joinToString(" · ")
            list.addView(ExtrasUi.card(this, p.title, sub, onMenu = { pageMenu(p) }) { open(p) })
        }
    }

    private fun pageMenu(p: SavedPage) {
        val actions = mutableListOf<Pair<String, () -> Unit>>(
            Tr.t("open") to { open(p) },
            Tr.t("open_with") to { openWith(p) },
            Tr.t("share") to { share(p) },
        )
        if (p.url.startsWith("http")) actions += Tr.t("open_source") to {
            startActivity(Intent(this, BrowserActivity::class.java).putExtra(BrowserActivity.EXTRA_URL, p.url))
        }
        actions += Tr.t("rename") to { renameDialog(p) }
        actions += Tr.t("delete") to { SavedPages.remove(this, p.id); render() }
        AlertDialog.Builder(this)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun uri(p: SavedPage): Uri = FileProvider.getUriForFile(this, "$packageName.files", SavedPages.file(this, p))

    /** Открываем в самом браузере (встроенный просмотр PDF движка), без сети. */
    private fun open(p: SavedPage) {
        startActivity(Intent(this, BrowserActivity::class.java)
            .putExtra(BrowserActivity.EXTRA_URL, Uri.fromFile(SavedPages.file(this, p)).toString()))
    }

    private fun openWith(p: SavedPage) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri(p), "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, Tr.t("cant_open_file"), Toast.LENGTH_SHORT).show()
        }
    }

    private fun share(p: SavedPage) {
        runCatching {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri(p))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, Tr.t("share")))
        }
    }

    private fun renameDialog(p: SavedPage) {
        val input = EditText(this).apply { setText(p.title); setSingleLine(); setTextColor(Ui.TEXT) }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("rename"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ -> SavedPages.rename(this, p.id, input.text.toString()); render() }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }
}
