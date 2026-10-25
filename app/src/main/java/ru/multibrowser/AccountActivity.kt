package ru.multibrowser

import android.app.KeyguardManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.TextView
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Личный кабинет профиля: всё, что пользователь сохранил, в одном месте — пароли (зашифрованы,
 * только на телефоне), наборы вкладок, избранное, заметки, файлы, загрузки и резервная копия в файл.
 */
class AccountActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
    }

    private var profile = 1
    private lateinit var list: LinearLayout
    private var pendingReveal: (() -> Unit)? = null
    private var backupPassword = ""

    // Пароль показываем только после подтверждения отпечатком/PIN телефона.
    private val confirmDevice = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == RESULT_OK) pendingReveal?.invoke()
        pendingReveal = null
    }

    private val exportFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null) writeBackup(uri)
    }

    private val importFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) askPassword(Tr.t("backup_pw"), confirm = false) { readBackup(uri, it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        // 0 — общий кабинет «Все профили» (с главного экрана).
        profile = intent.getIntExtra(EXTRA_PROFILE, 0).let { if (it == 0) 0 else it.coerceIn(1, Settings.profileCount(this)) }
        list = ExtrasUi.screen(this)
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    private fun render() {
        list.removeAllViews()
        list.addView(ExtrasUi.header(this, Tr.t("cabinet")))
        list.addView(profileChips())
        if (profile == 0) { renderAll(); return }
        val p = Profiles.get(this, profile)
        list.addView(ExtrasUi.card(this, p.name, listOfNotNull(p.email, p.description.takeIf { it.isNotBlank() }).joinToString(" · ").ifEmpty { null }))
        list.addView(ExtrasUi.hint(this, Tr.t("cabinet_desc")))

        // --- Пароли ---
        val logins = Passwords.list(this, profile).sortedBy { Uri.parse(it.origin).host }
        list.addView(sectionTitle(Tr.t("passwords") + " · " + logins.size))
        if (logins.isEmpty()) list.addView(ExtrasUi.hint(this, Tr.t("passwords_empty")))
        logins.forEach { l ->
            list.addView(ExtrasUi.card(this, Uri.parse(l.origin).host.orEmpty(), l.username.ifEmpty { "—" }, onMenu = { loginMenu(l) }) { loginMenu(l) })
        }
        list.addView(ExtrasUi.button(this, Tr.t("password_add")) { editLogin(null) })
        list.addView(ExtrasUi.button(this, Tr.t("pw_generator")) { generatorDialog() })
        list.addView(ExtrasUi.segmented(this, listOf(true, false), Passwords.offer(this),
            { if (it) Tr.t("pw_offer_on") else Tr.t("pw_offer_off") }) { Passwords.setOffer(this, it); render() },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        val never = Passwords.never(this, profile).sorted()
        if (never.isNotEmpty()) {
            list.addView(ExtrasUi.hint(this, Tr.t("never_sites")))
            never.forEach { host ->
                list.addView(ExtrasUi.card(this, host, null, onMenu = {
                    Passwords.setNever(this, profile, host, false); render()
                }))
            }
        }
        list.addView(ExtrasUi.hint(this, Tr.t("passwords_local")))

        // --- Наборы вкладок ---
        list.addView(sectionTitle(Tr.t("tab_sets")))
        val open = Tabs.list(this, profile).count { it.url.startsWith("http") }
        list.addView(ExtrasUi.button(this, Tr.t("tab_set_save", open)) { saveTabSet() })
        val sets = TabSets.list(this, profile)
        if (sets.isEmpty()) list.addView(ExtrasUi.hint(this, Tr.t("tab_set_empty")))
        val fmt = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
        sets.forEach { s ->
            list.addView(ExtrasUi.card(this, s.name, Tr.t("tabs_n", s.tabs.size) + " · " + fmt.format(Date(s.time)),
                onMenu = { tabSetMenu(s) }) { openSet(s) })
        }

        // --- Мои данные ---
        list.addView(sectionTitle(Tr.t("my_data")))
        list.addView(ExtrasUi.button(this, Tr.t("favorites")) { BookmarksActivity.open(this, profile) })
        list.addView(ExtrasUi.button(this, Tr.t("dl_title")) { startActivity(Intent(this, DownloadsActivity::class.java)) })
        list.addView(ExtrasUi.button(this, Tr.t("notes")) { startActivity(Intent(this, NotesActivity::class.java)) })
        list.addView(ExtrasUi.button(this, Tr.t("saved_pages")) { startActivity(Intent(this, SavedPagesActivity::class.java)) })
        list.addView(ExtrasUi.button(this, Tr.t("profile_settings")) {
            startActivity(Intent(this, ProfileActivity::class.java).putExtra(ProfileActivity.EXTRA_PROFILE, profile))
        })

        // --- Резервная копия ---
        list.addView(sectionTitle(Tr.t("backup")))
        list.addView(ExtrasUi.button(this, Tr.t("backup_export")) {
            askPassword(Tr.t("backup_pw"), confirm = true) { pw ->
                backupPassword = pw
                exportFile.launch("os-${p.name.filter { it.isLetterOrDigit() }.ifEmpty { "profile" }}-${SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())}.osbackup")
            }
        })
        list.addView(ExtrasUi.button(this, Tr.t("backup_import")) { importFile.launch(arrayOf("*/*")) })
        list.addView(ExtrasUi.hint(this, Tr.t("backup_desc")))
    }

    /** Переключатель профилей кабинета: «Все профили» и каждый профиль (цветной кружок и имя). */
    private fun profileChips(): View {
        val row = LinearLayout(this).apply { setPadding(0, dp(4), 0, dp(8)) }
        fun chip(label: String, color: Int?, id: Int) = TextView(this).apply {
            text = label
            textSize = 13f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER_VERTICAL
            val selected = id == profile
            setTextColor(if (selected) Ui.ON_ACCENT else Ui.TEXT)
            background = if (selected) Ui.rounded(Ui.ACCENT, dpf(16)) else Ui.rounded(Ui.SURFACE, dpf(16), dp(1))
            setPadding(dp(14), 0, dp(14), 0)
            if (color != null) {
                setCompoundDrawablesRelativeWithIntrinsicBounds(Ui.oval(color).apply { setSize(dp(10), dp(10)) }, null, null, null)
                compoundDrawablePadding = dp(8)
            }
            setOnClickListener { profile = id; render() }
        }
        row.addView(chip(Tr.t("all_profiles"), null, 0), LinearLayout.LayoutParams(-2, dp(36)))
        Profiles.all(this).forEach { p ->
            row.addView(chip(p.name, p.color, p.id), LinearLayout.LayoutParams(-2, dp(36)).apply { marginStart = dp(8) })
        }
        return android.widget.HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(row) }
    }

    /** Общий кабинет: сводка по профилям, поиск по всем паролям, генератор и копия всех профилей. */
    private fun renderAll() {
        list.addView(ExtrasUi.hint(this, Tr.t("cabinet_all_desc")))
        list.addView(sectionTitle(Tr.t("profiles")))
        Profiles.all(this).forEach { p ->
            val sub = listOf(
                Tr.t("passwords") + ": " + Passwords.count(this, p.id),
                Tr.t("tab_sets") + ": " + TabSets.list(this, p.id).size,
                Tr.t("profile_files") + ": " + ProfileFiles.count(this, p.id),
            ).joinToString(" · ")
            list.addView(ExtrasUi.card(this, p.name, sub) { profile = p.id; render() })
        }
        list.addView(sectionTitle(Tr.t("passwords")))
        val results = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val search = EditText(this).apply {
            hint = Tr.t("pw_search")
            setSingleLine()
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(14), dp(10), dp(14), dp(10))
        }
        fun show(q: String) {
            results.removeAllViews()
            val all = Profiles.all(this).flatMap { p -> Passwords.list(this, p.id).map { p to it } }
                .filter { (_, l) -> q.isBlank() || l.origin.contains(q, true) || l.username.contains(q, true) }
                .sortedBy { (_, l) -> Uri.parse(l.origin).host }
            if (all.isEmpty()) results.addView(ExtrasUi.hint(this, Tr.t(if (q.isBlank()) "passwords_empty" else "nothing_found")))
            all.take(200).forEach { (p, l) ->
                results.addView(ExtrasUi.card(this, Uri.parse(l.origin).host.orEmpty(), "${l.username.ifEmpty { "—" }} · ${p.name}",
                    onMenu = { profile = p.id; loginMenu(l) }) { profile = p.id; loginMenu(l) })
            }
        }
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(e: android.text.Editable?) = show(e?.toString().orEmpty())
        })
        list.addView(search, LinearLayout.LayoutParams(-1, dp(46)))
        list.addView(results)
        show("")
        list.addView(ExtrasUi.button(this, Tr.t("pw_generator")) { generatorDialog() })
        list.addView(sectionTitle(Tr.t("backup")))
        list.addView(ExtrasUi.button(this, Tr.t("backup_export_all")) {
            askPassword(Tr.t("backup_pw"), confirm = true) { pw ->
                backupPassword = pw
                exportFile.launch("os-all-profiles-${SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())}.osbackup")
            }
        })
        list.addView(ExtrasUi.button(this, Tr.t("backup_import")) { importFile.launch(arrayOf("*/*")) })
        list.addView(ExtrasUi.hint(this, Tr.t("backup_desc")))
    }

    /** Генератор: длина 8–32, цифры, знаки; копировать или создать новый. */
    private fun generatorDialog() {
        var length = 16
        var digits = true
        var symbols = true
        val out = TextView(this).apply {
            textSize = 20f
            typeface = android.graphics.Typeface.MONOSPACE
            setTextColor(Ui.TEXT)
            setTextIsSelectable(true)
            setPadding(0, dp(8), 0, dp(8))
        }
        val meta = TextView(this).apply { textSize = 13f; setTextColor(Ui.MUTED) }
        fun regen() {
            val p = PasswordGen.generate(length, digits, symbols)
            out.text = p
            meta.text = Tr.t("pw_length", length) + " · " + Tr.t(listOf("pw_weak", "pw_ok", "pw_strong", "pw_very_strong")[PasswordGen.strength(p)])
        }
        val seek = android.widget.SeekBar(this).apply {
            max = 24
            progress = length - 8
            setOnSeekBarChangeListener(object : android.widget.SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(b: android.widget.SeekBar, v: Int, user: Boolean) { length = v + 8; regen() }
                override fun onStartTrackingTouch(b: android.widget.SeekBar) {}
                override fun onStopTrackingTouch(b: android.widget.SeekBar) {}
            })
        }
        fun box(label: String, on: Boolean, set: (Boolean) -> Unit) = android.widget.CheckBox(this).apply {
            text = label
            isChecked = on
            setTextColor(Ui.TEXT)
            setOnCheckedChangeListener { _, v -> set(v); regen() }
        }
        val view = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(out)
            addView(meta)
            addView(seek)
            addView(box(Tr.t("pw_digits"), digits) { digits = it })
            addView(box(Tr.t("pw_symbols"), symbols) { symbols = it })
        }
        regen()
        val d = AlertDialog.Builder(this)
            .setTitle(Tr.t("pw_generator"))
            .setView(view)
            .setPositiveButton(Tr.t("copy_password")) { _, _ -> copy(out.text.toString()) }
            .setNeutralButton(Tr.t("pw_new"), null)
            .setNegativeButton(Tr.t("close"), null)
            .show()
        // «Новый» не закрывает окно.
        d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { regen() }
    }

    private fun loginMenu(l: Login) {
        val actions = listOf<Pair<String, () -> Unit>>(
            Tr.t("password_show") to { reveal { showPassword(l) } },
            Tr.t("copy_login") to { copy(l.username) },
            Tr.t("copy_password") to { reveal { copy(l.password) } },
            Tr.t("edit") to { reveal { editLogin(l) } },
            Tr.t("delete") to {
                AlertDialog.Builder(this).setTitle(Tr.t("delete") + "?").setMessage(Uri.parse(l.origin).host)
                    .setPositiveButton(Tr.t("delete")) { _, _ -> Passwords.remove(this, profile, l.guid); render() }
                    .setNegativeButton(Tr.t("cancel"), null).show()
            },
        )
        AlertDialog.Builder(this)
            .setTitle(Uri.parse(l.origin).host)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    /** Действие с паролем — после подтверждения отпечатком/PIN (если на телефоне есть блокировка). */
    private fun reveal(then: () -> Unit) {
        val km = getSystemService(KeyguardManager::class.java)
        @Suppress("DEPRECATION")
        val intent = if (km?.isDeviceSecure == true) km.createConfirmDeviceCredentialIntent(Tr.t("passwords"), null) else null
        if (intent == null) then() else { pendingReveal = then; confirmDevice.launch(intent) }
    }

    private fun showPassword(l: Login) {
        AlertDialog.Builder(this)
            .setTitle(Uri.parse(l.origin).host)
            .setMessage("${l.username}\n${l.password}")
            .setPositiveButton(Tr.t("copy_password")) { _, _ -> copy(l.password) }
            .setNegativeButton(Tr.t("close"), null)
            .show()
    }

    private fun copy(text: String) {
        getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("", text))
        Toast.makeText(this, Tr.t("password_copied"), Toast.LENGTH_SHORT).show()
    }

    private fun field(hint: String, value: String, type: Int) = EditText(this).apply {
        this.hint = hint
        setText(value)
        setSingleLine()
        inputType = type
        setTextColor(Ui.TEXT)
        setHintTextColor(Ui.MUTED)
    }

    private fun editLogin(l: Login?) {
        val site = field(Tr.t("password_site"), l?.origin.orEmpty(), InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val user = field(Tr.t("password_login"), l?.username.orEmpty(), InputType.TYPE_CLASS_TEXT)
        val pass = field(Tr.t("password_value"), l?.password.orEmpty(), InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            listOf(site, user, pass).forEach { addView(it) }
            addView(TextView(context).apply {
                text = "🔑 " + Tr.t("pw_generate")
                textSize = 14f
                setTextColor(Ui.ACCENT)
                setPadding(0, dp(10), 0, dp(4))
                setOnClickListener { pass.setText(PasswordGen.generate()) }
            })
        }
        AlertDialog.Builder(this)
            .setTitle(if (l == null) Tr.t("password_add") else Tr.t("edit"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                val url = site.text.toString().trim().let { if (it.contains("://")) it else "https://$it" }
                if (site.text.isNotBlank() && pass.text.isNotEmpty()) {
                    Passwords.upsert(this, profile, url, user.text.toString().trim(), pass.text.toString(), l?.guid)
                }
                render()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun saveTabSet() {
        val name = field(Tr.t("tab_set_name_q"), SimpleDateFormat("dd.MM HH:mm", Locale.getDefault()).format(Date()), InputType.TYPE_CLASS_TEXT)
        val box = LinearLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(name, LinearLayout.LayoutParams(-1, -2)) }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("tab_set_name_q"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                if (TabSets.saveOpen(this, profile, name.text.toString()) == null) {
                    Toast.makeText(this, Tr.t("tab_sets_none"), Toast.LENGTH_SHORT).show()
                }
                render()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun tabSetMenu(s: TabSet) {
        val actions = listOf<Pair<String, () -> Unit>>(
            Tr.t("open") to { openSet(s) },
            Tr.t("delete") to { TabSets.remove(this, profile, s.id); render() },
        )
        AlertDialog.Builder(this)
            .setTitle(s.name)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun openSet(s: TabSet) {
        val first = TabSets.restore(this, profile, s) ?: return
        startActivity(Intent(this, BrowserActivity::class.java)
            .putExtra(BrowserActivity.EXTRA_PROFILE, profile)
            .putExtra(BrowserActivity.EXTRA_SITE, first))
    }

    private fun askPassword(title: String, confirm: Boolean, then: (String) -> Unit) {
        val type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        val pw = field(Tr.t("password_value"), "", type)
        val again = field(Tr.t("backup_pw_again"), "", type)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(pw)
            if (confirm) addView(again)
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(box)
            .setPositiveButton("OK") { _, _ ->
                val value = pw.text.toString()
                when {
                    value.length < 6 -> Toast.makeText(this, Tr.t("backup_pw_short"), Toast.LENGTH_LONG).show()
                    confirm && value != again.text.toString() -> Toast.makeText(this, Tr.t("backup_pw_mismatch"), Toast.LENGTH_LONG).show()
                    else -> then(value)
                }
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun writeBackup(uri: Uri) {
        val pw = backupPassword
        backupPassword = ""
        val data = if (profile == 0) Backup.collectAll(this) else Backup.collect(this, profile)
        Thread {
            val ok = runCatching {
                val text = Backup.encrypt(data, pw)
                contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) } ?: error("no stream")
            }.isSuccess
            runOnUiThread { Toast.makeText(this, Tr.t(if (ok) "backup_done" else "backup_bad"), Toast.LENGTH_LONG).show() }
        }.start()
    }

    private fun readBackup(uri: Uri, pw: String) {
        Thread {
            val text = runCatching { contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull()
            val data = text?.let { Backup.decrypt(it, pw) }
            runOnUiThread {
                if (data == null) {
                    Toast.makeText(this, Tr.t("backup_bad"), Toast.LENGTH_LONG).show()
                } else {
                    val r = Backup.applyAny(this, if (profile == 0) Profiles.lastProfile(this) else profile, data)
                    AlertDialog.Builder(this)
                        .setTitle(Tr.t("backup"))
                        .setMessage(Tr.t("backup_restored", r.passwords, r.tabSets, r.favorites, r.notes))
                        .setPositiveButton("OK", null)
                        .show()
                    render()
                }
            }
        }.start()
    }
}
