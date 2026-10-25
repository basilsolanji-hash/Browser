package ru.multibrowser

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.text.format.Formatter
import android.view.Gravity
import android.webkit.MimeTypeMap
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Настройки профиля: имя, закрепление, описание, вкладки, файлы и очистка данных — всё в одном месте. */
class ProfileActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
    }

    private var profile = 1 // не «id»: внутри apply { } у View есть своё id
    private lateinit var list: LinearLayout
    private lateinit var description: EditText
    private lateinit var name: EditText

    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@registerForActivityResult
        val ctx = applicationContext
        Thread {
            val added = uris.count { uri -> runCatching { ProfileFiles.add(ctx, profile, uri) }.isSuccess }
            runOnUiThread {
                if (added < uris.size) Toast.makeText(this, Tr.t("file_add_failed"), Toast.LENGTH_SHORT).show()
                if (!isFinishing) render()
            }
        }.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        profile = intent.getIntExtra(EXTRA_PROFILE, 1).coerceIn(1, Settings.profileCount(this))
        list = ExtrasUi.screen(this)
        name = EditText(this).apply {
            setText(Profiles.customName(this@ProfileActivity, profile))
            hint = Tr.t("profile_n", profile)
            contentDescription = Tr.t("profile_name")
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        description = EditText(this).apply {
            setText(Profiles.get(this@ProfileActivity, profile).description)
            hint = Tr.t("profile_desc_hint")
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            minLines = 2
            maxLines = 6
            gravity = Gravity.TOP or Gravity.START
            textSize = 14f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    override fun onPause() {
        super.onPause()
        // Не трогаем, если не меняли: описание-пример хранится ключом и переводится вместе с языком.
        val text = description.text.toString()
        if (text != Profiles.get(this, profile).description) Profiles.setDescription(this, profile, text)
        val newName = name.text.toString()
        if (newName != Profiles.customName(this, profile)) Profiles.rename(this, profile, newName)
    }

    private fun render() {
        list.removeAllViews()
        val p = Profiles.get(this, profile)
        list.addView(ExtrasUi.header(this, p.name,
            ExtrasUi.headerAction(this, "+", Tr.t("add_files")) { pickFiles.launch(arrayOf("*/*")) }))

        list.addView(ExtrasUi.button(this, Tr.t("cabinet")) {
            startActivity(Intent(this, AccountActivity::class.java).putExtra(AccountActivity.EXTRA_PROFILE, profile))
        })
        list.addView(sectionTitle(Tr.t("profile_name")))
        (name.parent as? LinearLayout)?.removeView(name)
        list.addView(name, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        val pinned = Profiles.isPinned(this, profile)
        list.addView(ExtrasUi.segmented(this, listOf(false, true), pinned,
            { if (it) Tr.t("profile_pinned") else Tr.t("profile_pin") }) {
            Profiles.setPinned(this, profile, it); render()
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })

        list.addView(sectionTitle(Tr.t("profile_desc")))
        (description.parent as? LinearLayout)?.removeView(description)
        list.addView(description, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // Свои вкладки профиля или общий набор из настроек.
        list.addView(sectionTitle(Tr.t("pinned_tabs")))
        list.addView(PinEditor(this, profile) { render() }.view)
        if (Pins.hasOwn(this, profile)) {
            list.addView(ExtrasUi.button(this, Tr.t("tabs_use_common")) { Pins.useCommon(this, profile); render() })
            list.addView(ExtrasUi.hint(this, Tr.t("tabs_own_desc")))
        } else {
            list.addView(ExtrasUi.hint(this, Tr.t("tabs_common_desc")))
        }

        list.addView(sectionTitle(Tr.t("profile_files")))
        val files = ProfileFiles.list(this, profile)
        if (files.isEmpty()) list.addView(ExtrasUi.hint(this, Tr.t("profile_files_empty")))
        val fmt = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
        files.forEach { f ->
            val sub = "${Formatter.formatShortFileSize(this, f.length())} · ${fmt.format(Date(f.lastModified()))}"
            list.addView(ExtrasUi.card(this, f.name, sub, onMenu = { fileMenu(f) }) { open(f) })
        }
        list.addView(ExtrasUi.button(this, Tr.t("add_files")) { pickFiles.launch(arrayOf("*/*")) })
        list.addView(ExtrasUi.hint(this, Tr.t("profile_files_local")))

        list.addView(sectionTitle(Tr.t("data")))
        list.addView(ExtrasUi.button(this, Tr.t("logout_clear")) {
            AlertDialog.Builder(this)
                .setTitle(Tr.t("clear_q", p.name))
                .setMessage(Tr.t("clear_profile_msg"))
                .setPositiveButton(Tr.t("clear")) { _, _ -> Gecko.clearProfile(this, profile); render() }
                .setNegativeButton(Tr.t("cancel"), null)
                .show()
        })
    }

    private fun fileMenu(f: File) {
        val actions = listOf<Pair<String, () -> Unit>>(
            Tr.t("open") to { open(f) },
            Tr.t("share") to { share(f) },
            Tr.t("rename") to { renameDialog(f) },
            Tr.t("delete") to { confirmDelete(f) },
        )
        AlertDialog.Builder(this)
            .setTitle(f.name)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun uri(f: File): Uri = FileProvider.getUriForFile(this, "$packageName.files", f)

    private fun mime(f: File): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(f.extension.lowercase()) ?: "application/octet-stream"

    private fun open(f: File) {
        if (!ProfileFiles.owns(this, profile, f)) return
        val mime = Downloads.effectiveMime("", f.name)
        if (DocView.supports(f.name) || Downloads.viewableInOs(mime)) { openInOs(f); return }
        try {
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri(f), mime(f))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, Tr.t("cant_open_file"), Toast.LENGTH_SHORT).show()
        }
    }

    /** Документы, PDF, картинки и текст — во вкладке Оси (копия во временной папке просмотра). */
    private fun openInOs(f: File) {
        val app = applicationContext
        Thread {
            val view = runCatching {
                if (DocView.supports(f.name)) {
                    val html = f.inputStream().use { DocView.toHtml(it, f.name) } ?: error("unsupported")
                    File(Downloads.viewDir(app), Uploads.safeName(f.name) + ".html").apply { writeText(html) }
                } else f.copyTo(File(Downloads.viewDir(app), Uploads.safeName(f.name)), overwrite = true)
            }.getOrNull()
            runOnUiThread {
                if (view == null) { Toast.makeText(this, Tr.t("cant_open_file"), Toast.LENGTH_SHORT).show(); return@runOnUiThread }
                startActivity(Intent(this, BrowserActivity::class.java)
                    .putExtra(BrowserActivity.EXTRA_PROFILE, profile)
                    .putExtra(BrowserActivity.EXTRA_ACTION, BrowserActivity.ACTION_NEW_TAB)
                    .putExtra(BrowserActivity.EXTRA_URL, Uri.fromFile(view).toString()))
            }
        }.start()
    }

    private fun share(f: File) {
        if (!ProfileFiles.owns(this, profile, f)) return
        runCatching {
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = mime(f)
                putExtra(Intent.EXTRA_STREAM, uri(f))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, Tr.t("share")))
        }
    }

    private fun renameDialog(f: File) {
        val input = EditText(this).apply { setText(f.name); setSingleLine(); setTextColor(Ui.TEXT) }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("rename"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ -> ProfileFiles.rename(this, f, input.text.toString()); render() }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun confirmDelete(f: File) {
        AlertDialog.Builder(this)
            .setTitle(Tr.t("delete_file_q"))
            .setMessage(f.name)
            .setPositiveButton(Tr.t("delete")) { _, _ -> f.delete(); render() }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }
}
