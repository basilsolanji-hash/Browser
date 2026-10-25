package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Настройки. Главная — поиск и группы с иконками (Основные, Профили, Панели и вкладки,
 * Конфиденциальность, Данные, Библиотека, О приложении); нажатие открывает группу.
 * При вводе в поиск показываются подходящие разделы из всех групп.
 */
class SettingsActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_GROUP = "group"

        /** Группы: id, ключ названия, иконка. */
        val GROUPS = listOf(
            Triple("general", "sg_general", R.drawable.ic_settings),
            Triple("profiles", "sg_profiles", R.drawable.ic_group),
            Triple("panels", "sg_panels", R.drawable.ic_tabs),
            Triple("privacy", "sg_privacy", R.drawable.ic_shield),
            Triple("data", "sg_data", R.drawable.ic_delete),
            Triple("library", "sg_library", R.drawable.ic_book),
            Triple("about", "sg_about", R.drawable.ic_info),
        )
    }

    /** null — главная страница настроек. */
    private var group: String? = null

    private lateinit var countLabel: TextView
    private lateinit var seek: SeekBar
    private lateinit var names: LinearLayout

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        group = intent.getStringExtra(EXTRA_GROUP)?.takeIf { g -> GROUPS.any { it.first == g } }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(32))
        }
        val root = ScrollView(this).apply {
            setBackgroundColor(Ui.BG)
            isFillViewport = true
            addView(content)
        }
        setContentView(root)
        applyEdgeToEdge(root)

        content.addView(header())
        if (group == null) content.addView(searchField())
        this.content = content
        groupList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(groupList)

        currentGroup = "general"
        section(Tr.t("language")).addView(button(languageLabel(Settings.language(this))) { languageDialog() })
        section(Tr.t("theme")).addView(button(themeLabel(Settings.themeId(this))) { themeDialog() })
        section(Tr.t("search_engine")).addView(button(Search.current(this).title) { searchDialog() })
        currentGroup = "privacy"
        section(Tr.t("block_screenshots")).apply {
            addView(switchRow(R.drawable.ic_shield, Tr.t("block_screenshots"), Tr.t("block_screenshots_desc"),
                Settings.hideContent(this@SettingsActivity)) {
                Settings.setHideContent(this@SettingsActivity, it)
                AppLock.onResume(this@SettingsActivity)
            })
        }
        section(Tr.t("privacy_security")).apply {
            addView(button(Tr.t("security_check")) {
                startActivity(Intent(this@SettingsActivity, SecurityCheckActivity::class.java))
            })
            addView(button(Tr.t("site_settings")) {
                startActivity(Intent(this@SettingsActivity, SiteSettingsActivity::class.java))
            })
            addView(segmented(listOf(true, false), Settings.lockEnabled(this@SettingsActivity),
                { if (it) Tr.t("lock_on") else Tr.t("lock_off") }) {
                Settings.setLockEnabled(this@SettingsActivity, it)
                recreate()
            }, spaced())
            if (!AppLock.deviceSecure(this@SettingsActivity)) {
                addView(hint(Tr.t("no_screen_lock")))
            }
            addView(segmented(listOf(false, true), Settings.httpsOnly(this@SettingsActivity),
                { if (it) Tr.t("https_on") else Tr.t("https_off") }) {
                Settings.setHttpsOnly(this@SettingsActivity, it)
                recreate()
            }, spaced())
            addView(hint(Tr.t("https_desc")))
        }
        currentGroup = "panels"
        section(Tr.t("bottom_button")).apply {
            addView(button(bottomLabel(Settings.bottomButton(this@SettingsActivity))) { bottomDialog() })
            addView(hint(Tr.t("bottom_button_desc")))
        }
        section(Tr.t("scroll_bars")).addView(segmented(listOf(true, false), Settings.autoHideBars(this),
            { if (it) Tr.t("hide_bars") else Tr.t("always_visible") }) {
            Settings.setAutoHideBars(this, it)
            recreate()
        })
        section(Tr.t("address_tabs")).addView(segmented(Settings.BarPosition.values().toList(), Settings.barPosition(this),
            { if (it == Settings.BarPosition.TOP) Tr.t("top") else Tr.t("bottom") }) {
            Settings.setBarPosition(this, it)
            recreate()
        })
        currentGroup = "profiles"
        section(Tr.t("profile_strip")).addView(segmented(listOf(false, true), Settings.showSwitcher(this), { if (it) Tr.t("show") else Tr.t("hide") }) {
            Settings.setShowSwitcher(this, it)
            recreate()
        })
        currentGroup = "panels"
        section(Tr.t("live_tabs")).apply {
            addView(segmented(Settings.KEEP_ALIVE_OPTIONS, Settings.keepAlive(this@SettingsActivity), { it.toString() }) {
                Settings.setKeepAlive(this@SettingsActivity, it)
                recreate()
            })
            addView(hint(Tr.t("live_tabs_desc")))
        }
        currentGroup = "profiles"
        section(Tr.t("profiles_count")).addView(countSelector())
        section(Tr.t("profile_names")).apply {
            names = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            addView(names)
            renderNames()
        }
        section(Tr.t("pinned_tabs")).apply {
            addView(PinEditor(this@SettingsActivity, null).view)
            addView(hint(Tr.t("pinned_desc_common")))
        }
        currentGroup = "data"
        section(Tr.t("data")).apply {
            addView(button(Tr.t("clear_cache_all")) {
                Gecko.clearCache(this@SettingsActivity)
                toast(Tr.t("cache_cleared"))
            })
            addView(button(Tr.t("clear_history_all")) {
                confirm(Tr.t("clear_history_all_q")) {
                    History.clearAll(this@SettingsActivity)
                    toast(Tr.t("history_cleared"))
                }
            })
        }
        // Разделы блоков D/E: в свои группы по названию.
        val extrasGroups = mapOf(
            Tr.t("home_page") to "general", Tr.t("default_browser") to "general",
            Tr.t("my_library") to "library", Tr.t("about_section") to "about",
        )
        ExtrasSettings.addTo(this) { title -> currentGroup = extrasGroups[title] ?: "about"; section(title) }
        renderGroups()
        nothingFound = hint(Tr.t("nothing_found")).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(32), 0, 0)
            visibility = View.GONE
        }
        content.addView(nothingFound)
        filter("")
    }

    // --- Поиск в настройках (№32): фильтр секций по переведённым заголовкам и подписям ---

    private lateinit var content: LinearLayout
    private lateinit var groupList: LinearLayout
    private lateinit var nothingFound: TextView
    private val sections = mutableListOf<LinearLayout>()
    private val sectionGroup = mutableMapOf<LinearLayout, String>()
    private var currentGroup = "general"

    private fun section(title: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        addView(sectionTitle(title))
        content.addView(this)
        sections += this
        sectionGroup[this] = currentGroup
        setTag(R.id.profile_row, title) // исходное название (заголовок раздела показывается заглавными)
    }

    /** Главная настроек: карточки групп с иконкой и перечнем разделов. */
    private fun renderGroups() {
        groupList.removeAllViews()
        if (group != null) return
        GROUPS.forEach { (id, key, iconRes) ->
            val titles = sections.filter { sectionGroup[it] == id }
                .mapNotNull { (it.getTag(R.id.profile_row) as? String) }
                .filter { !it.equals(Tr.t(key), true) }
            groupList.addView(LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, dpf(12), dp(1))
                setPadding(dp(14), dp(12), dp(10), dp(12))
                contentDescription = Tr.t(key)
                setOnClickListener {
                    startActivity(Intent(this@SettingsActivity, SettingsActivity::class.java).putExtra(EXTRA_GROUP, id))
                }
                addView(android.widget.FrameLayout(context).apply {
                    background = Ui.oval(Ui.BG)
                    addView(icon(iconRes, Ui.ACCENT, 22), android.widget.FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
                }, LinearLayout.LayoutParams(dp(44), dp(44)))
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(14), 0, dp(6), 0)
                    addView(TextView(context).apply {
                        text = Tr.t(key)
                        textSize = 16f
                        typeface = Typeface.DEFAULT_BOLD
                        setTextColor(Ui.TEXT)
                    })
                    addView(TextView(context).apply {
                        text = titles.joinToString(" · ")
                        visibility = if (titles.isEmpty()) View.GONE else View.VISIBLE
                        textSize = 12f
                        setTextColor(Ui.MUTED)
                        maxLines = 2
                        ellipsize = android.text.TextUtils.TruncateAt.END
                    })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(icon(R.drawable.ic_forward, Ui.MUTED, 18))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(10) })
        }
    }

    /** Строка-переключатель: иконка, название, пояснение, Switch справа. */
    private fun switchRow(iconRes: Int, title: String, desc: String, checked: Boolean, onChange: (Boolean) -> Unit): View {
        val sw = androidx.appcompat.widget.SwitchCompat(this).apply {
            isChecked = checked
            contentDescription = title
            thumbTintList = android.content.res.ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(Ui.ACCENT, Ui.MUTED))
            setOnCheckedChangeListener { _, on -> onChange(on) }
        }
        return LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(14), dp(10), dp(10), dp(10))
            setOnClickListener { sw.toggle() }
            addView(icon(iconRes, Ui.TEXT, 22))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), 0, dp(8), 0)
                addView(TextView(context).apply { text = title; textSize = 15f; setTextColor(Ui.TEXT) })
                addView(TextView(context).apply { text = desc; textSize = 12f; setTextColor(Ui.MUTED) })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(sw)
            layoutParams = spaced()
        }
    }

    private fun bottomLabel(id: String) = when (id) {
        "clear" -> Tr.t("clear_short")
        "favorites" -> Tr.t("favorites")
        "tabs" -> Tr.t("tabs")
        "notes" -> Tr.t("notes")
        "saved" -> Tr.t("saved_pages")
        "share" -> Tr.t("share")
        "find" -> Tr.t("find_in_page")
        else -> Tr.t("downloads")
    }

    private fun bottomDialog() {
        val ids = Settings.BOTTOM_BUTTONS
        AlertDialog.Builder(this)
            .setTitle(Tr.t("bottom_button"))
            .setSingleChoiceItems(ids.map { bottomLabel(it) }.toTypedArray(), ids.indexOf(Settings.bottomButton(this))) { d, i ->
                Settings.setBottomButton(this, ids[i])
                d.dismiss()
                recreate()
            }
            .show()
    }

    private fun spaced() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(8) }

    private fun searchField() = EditText(this).apply {
        hint = Tr.t("search_settings")
        setSingleLine()
        inputType = InputType.TYPE_CLASS_TEXT
        imeOptions = EditorInfo.IME_ACTION_SEARCH
        textSize = 15f
        setTextColor(Ui.TEXT)
        setHintTextColor(Ui.MUTED)
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setPadding(dp(14), dp(10), dp(14), dp(10))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46))
            .apply { topMargin = dp(12) }
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) = filter(s?.toString().orEmpty())
        })
    }

    private fun filter(query: String) {
        val q = query.trim().lowercase()
        // Главная без запроса — только группы; в группе — её разделы; с запросом — совпадения.
        val home = group == null && q.isEmpty()
        groupList.visibility = if (home) View.VISIBLE else View.GONE
        var shown = 0
        sections.forEach { sec ->
            val inScope = group == null || sectionGroup[sec] == group
            val match = !home && inScope && (q.isEmpty() || texts(sec).any { it.lowercase().contains(q) })
            sec.visibility = if (match) View.VISIBLE else View.GONE
            if (match) shown++
        }
        nothingFound.visibility = if (!home && shown == 0) View.VISIBLE else View.GONE
    }

    /** Все видимые подписи секции (без полей ввода — в них пользовательские данные). */
    private fun texts(view: View): List<String> = when (view) {
        is EditText -> emptyList()
        is TextView -> listOf(view.text.toString())
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    } + listOfNotNull(view.contentDescription?.toString())

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(iconButton(R.drawable.ic_back, Tr.t("back")) { finish() },
            LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(TextView(context).apply {
            text = GROUPS.firstOrNull { it.first == group }?.let { Tr.t(it.second) } ?: Tr.t("settings")
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(dp(4), 0, 0, 0)
        })
    }

    // Смена темы пересоздаёт экраны с новыми цветами.
    private fun searchDialog() {
        val engines = Search.ENGINES
        AlertDialog.Builder(this)
            .setTitle(Tr.t("search_engine"))
            .setItems(engines.map { it.title }.toTypedArray()) { _, i ->
                Search.set(this, engines[i].id)
                recreate()
            }
            .show()
    }

    private fun themeLabel(id: String) =
        if (id == "system") Tr.t("system") else Tr.t(Themes.nameKey(id))

    private fun themeDialog() {
        val ids = Themes.IDS
        AlertDialog.Builder(this)
            .setTitle(Tr.t("theme"))
            .setItems(ids.map { themeLabel(it) }.toTypedArray()) { _, i ->
                Settings.setThemeId(this, ids[i])
                recreate()
            }
            .show()
    }

    /** Сегментированный переключатель в стиле вкладок Gmail/Claude. */
    private fun <T> segmented(options: List<T>, current: T, label: (T) -> String, onPick: (T) -> Unit): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        options.forEach { option ->
            val selected = option == current
            bar.addView(TextView(this).apply {
                text = label(option)
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                maxLines = 2 // длинные подписи («Вход по отпечатку/PIN») переносятся, а не обрезаются
                minHeight = dp(40)
                setPadding(dp(4), dp(4), dp(4), dp(4))
                background = if (selected) Ui.rounded(Ui.ACCENT, dpf(5)) else null
                setTextColor(if (selected) Ui.ON_ACCENT else Ui.MUTED)
                setOnClickListener { if (!selected) onPick(option) }
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                gravity = Gravity.CENTER_VERTICAL
            })
        }
        return bar
    }

    private fun countSelector(): View {
        val count = Settings.profileCount(this)
        countLabel = TextView(this).apply {
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Ui.TEXT)
        }
        seek = SeekBar(this).apply {
            min = Settings.MIN_PROFILES
            max = Settings.MAX_PROFILES
            progress = count
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
                    countLabel.text = value.toString()
                }

                override fun onStartTrackingTouch(bar: SeekBar) {}

                override fun onStopTrackingTouch(bar: SeekBar) = setCount(bar.progress)
            })
        }
        countLabel.text = count.toString()

        fun stepper(symbol: String, delta: Int) = TextView(this).apply {
            text = symbol
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Ui.TEXT)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setOnClickListener { setCount(Settings.profileCount(this@SettingsActivity) + delta) }
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), dp(12), dp(12), dp(8))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                addView(stepper("−", -1), LinearLayout.LayoutParams(dp(44), dp(40)))
                addView(countLabel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(stepper("+", 1), LinearLayout.LayoutParams(dp(44), dp(40)))
            })
            addView(seek, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(36))
                .apply { topMargin = dp(8) })
            addView(TextView(context).apply {
                text = Tr.t("range_desc", Settings.MIN_PROFILES, Settings.MAX_PROFILES)
                textSize = 12f
                setTextColor(Ui.MUTED)
            })
        }
    }

    private fun setCount(n: Int) {
        Settings.setProfileCount(this, n)
        val actual = Settings.profileCount(this)
        countLabel.text = actual.toString()
        if (seek.progress != actual) seek.progress = actual
        renderNames()
    }

    private fun renderNames() {
        names.removeAllViews()
        for (id in 1..Settings.profileCount(this)) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
                clipToOutline = true
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(6) }
            }
            row.addView(View(this).apply { setBackgroundColor(Profiles.color(id)) },
                LinearLayout.LayoutParams(dp(3), dp(48)))
            row.addView(TextView(this).apply {
                text = id.toString()
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(Ui.MUTED)
            }, LinearLayout.LayoutParams(dp(36), LinearLayout.LayoutParams.WRAP_CONTENT))
            row.addView(EditText(this).apply {
                setText(Profiles.customName(this@SettingsActivity, id))
                hint = Tr.t("profile_n", id)
                setSingleLine()
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                textSize = 15f
                setTextColor(Ui.TEXT)
                setHintTextColor(Ui.MUTED)
                background = null
                setPadding(0, dp(12), dp(12), dp(12))
                addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                    override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        Profiles.rename(this@SettingsActivity, id, s?.toString().orEmpty())
                    }
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            names.addView(row)
        }
    }

    private fun languageLabel(code: String) = if (code == "system") Tr.t("system") else Tr.NAMES[code] ?: code

    private fun languageDialog() {
        val codes = Tr.CODES
        val labels = codes.map { languageLabel(it) }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(Tr.t("language"))
            .setItems(labels) { _, i ->
                Settings.setLanguage(this, codes[i])
                Tr.apply(this)
                Gecko.onLanguageChanged()
                // Пересоздаём весь стек экранов (главный под настройками), чтобы язык сменился сразу везде.
                androidx.core.app.TaskStackBuilder.create(this)
                    .addNextIntent(Intent(this, MainActivity::class.java))
                    .addNextIntent(Intent(this, SettingsActivity::class.java))
                    .startActivities()
                @Suppress("DEPRECATION") overridePendingTransition(0, 0)
            }
            .show()
    }

    private fun hint(text: String) = TextView(this).apply {
        this.text = text
        textSize = 12f
        setTextColor(Ui.MUTED)
        setPadding(0, dp(6), 0, 0)
    }

    private fun button(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(Ui.TEXT)
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44))
            .apply { topMargin = dp(8) }
        setOnClickListener { onClick() }
    }

    private fun confirm(title: String, onYes: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle(title)
            .setPositiveButton(Tr.t("clear")) { _, _ -> onYes() }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
