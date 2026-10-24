package ru.multibrowser

import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Настройки: тема, количество профилей (1–50), названия профилей, очистка данных. */
class SettingsActivity : AppCompatActivity() {

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
        content.addView(sectionTitle(Tr.t("pinned_tabs")))
        content.addView(PinEditor(this, null).view)
        content.addView(hint(Tr.t("pinned_desc_common")))
        content.addView(sectionTitle(Tr.t("language")))
        content.addView(button(languageLabel(Settings.language(this))) { languageDialog() })
        content.addView(sectionTitle(Tr.t("theme")))
        content.addView(button(themeLabel(Settings.themeId(this))) { themeDialog() })
        content.addView(sectionTitle(Tr.t("search_engine")))
        content.addView(button(Search.current(this).title) { searchDialog() })
        content.addView(sectionTitle(Tr.t("privacy_security")))
        content.addView(segmented(listOf(true, false), Settings.lockEnabled(this),
            { if (it) Tr.t("lock_on") else Tr.t("lock_off") }) {
            Settings.setLockEnabled(this, it)
            recreate()
        })
        if (!AppLock.deviceSecure(this)) {
            content.addView(hint(Tr.t("no_screen_lock")))
        }
        content.addView(segmented(listOf(false, true), Settings.hideContent(this),
            { if (it) Tr.t("hide_content") else Tr.t("show") }) {
            Settings.setHideContent(this, it)
            recreate()
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(8) })
        content.addView(hint(Tr.t("hide_content_desc")))
        content.addView(sectionTitle(Tr.t("scroll_bars")))
        content.addView(segmented(listOf(true, false), Settings.autoHideBars(this),
            { if (it) Tr.t("hide_bars") else Tr.t("always_visible") }) {
            Settings.setAutoHideBars(this, it)
            recreate()
        })
        content.addView(sectionTitle(Tr.t("address_tabs")))
        content.addView(segmented(Settings.BarPosition.values().toList(), Settings.barPosition(this),
            { if (it == Settings.BarPosition.TOP) Tr.t("top") else Tr.t("bottom") }) {
            Settings.setBarPosition(this, it)
            recreate()
        })
        content.addView(sectionTitle(Tr.t("profile_strip")))
        content.addView(segmented(listOf(false, true), Settings.showSwitcher(this), { if (it) Tr.t("show") else Tr.t("hide") }) {
            Settings.setShowSwitcher(this, it)
            recreate()
        })
        content.addView(sectionTitle(Tr.t("live_tabs")))
        content.addView(segmented(Settings.KEEP_ALIVE_OPTIONS, Settings.keepAlive(this), { it.toString() }) {
            Settings.setKeepAlive(this, it)
            recreate()
        })
        content.addView(hint(Tr.t("live_tabs_desc")))
        content.addView(sectionTitle(Tr.t("profiles_count")))
        content.addView(countSelector())
        content.addView(sectionTitle(Tr.t("profile_names")))
        names = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(names)
        renderNames()
        content.addView(sectionTitle(Tr.t("data")))
        content.addView(button(Tr.t("clear_cache_all")) {
            Gecko.clearCache(this)
            toast(Tr.t("cache_cleared"))
        })
        content.addView(button(Tr.t("clear_history_all")) {
            confirm(Tr.t("clear_history_all_q")) {
                History.clearAll(this)
                toast(Tr.t("history_cleared"))
            }
        })
        ExtrasSettings.addTo(this, content)
    }

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(iconButton(R.drawable.ic_back, Tr.t("back")) { finish() },
            LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(TextView(context).apply {
            text = Tr.t("settings")
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
                recreate()
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
