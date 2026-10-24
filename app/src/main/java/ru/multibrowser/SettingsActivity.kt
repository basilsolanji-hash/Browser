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
    private lateinit var pins: LinearLayout

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        content.addView(sectionTitle("Закреплённые вкладки"))
        pins = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(pins)
        renderPins()
        content.addView(button("+ Добавить вкладку") { editPinDialog(null) })
        content.addView(hint("Эти вкладки видны в каждом профиле. В профиле у каждой вкладки свой вход и cookies, " +
            "поэтому одна и та же вкладка в разных профилях — это разные аккаунты."))
        content.addView(sectionTitle("Тема"))
        content.addView(themeSelector())
        content.addView(sectionTitle("Защита"))
        content.addView(segmented(listOf(true, false), Settings.lockEnabled(this),
            { if (it) "Вход по отпечатку/PIN" else "Без блокировки" }) {
            Settings.setLockEnabled(this, it)
            recreate()
        })
        if (!AppLock.deviceSecure(this)) {
            content.addView(hint("На телефоне не задана блокировка экрана — сначала включите её в настройках Android."))
        }
        content.addView(segmented(listOf(false, true), Settings.hideContent(this),
            { if (it) "Скрывать содержимое" else "Показывать" }) {
            Settings.setHideContent(this, it)
            recreate()
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(8) })
        content.addView(hint("«Скрывать содержимое»: в списке недавних приложений не видно страниц, скриншоты запрещены. " +
            "Блокировка запрашивается при запуске и после минуты в фоне."))
        content.addView(sectionTitle("Панели при прокрутке"))
        content.addView(segmented(listOf(true, false), Settings.autoHideBars(this),
            { if (it) "Прятать" else "Всегда видны" }) {
            Settings.setAutoHideBars(this, it)
            recreate()
        })
        content.addView(sectionTitle("Адресная строка и вкладки"))
        content.addView(segmented(Settings.BarPosition.values().toList(), Settings.barPosition(this), { it.title }) {
            Settings.setBarPosition(this, it)
            recreate()
        })
        content.addView(sectionTitle("Полоса профилей внизу браузера"))
        content.addView(segmented(listOf(false, true), Settings.showSwitcher(this), { if (it) "Показывать" else "Скрыть" }) {
            Settings.setShowSwitcher(this, it)
            recreate()
        })
        content.addView(sectionTitle("Вкладок в памяти одновременно"))
        content.addView(segmented(Settings.KEEP_ALIVE_OPTIONS, Settings.keepAlive(this), { it.toString() }) {
            Settings.setKeepAlive(this, it)
            recreate()
        })
        content.addView(TextView(this).apply {
            text = "Столько вкладок Gmail/Claude работают в фоне, не перезагружаясь: можно запустить ответ Claude " +
                "в одном профиле и спокойно переключиться в другой. Больше — удобнее, но нужно больше памяти " +
                "(10–15 — для телефонов с 8 ГБ и более)."
            textSize = 12f
            setTextColor(Ui.MUTED)
            setPadding(0, dp(6), 0, 0)
        })
        content.addView(sectionTitle("Количество профилей"))
        content.addView(countSelector())
        content.addView(sectionTitle("Названия профилей"))
        names = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(names)
        renderNames()
        content.addView(sectionTitle("Данные"))
        content.addView(button("Очистить кэш всех профилей") {
            Gecko.clearCache(this)
            toast("Кэш очищен. Входы в аккаунты сохранены")
        })
        content.addView(button("Очистить историю всех профилей") {
            confirm("Очистить историю всех профилей?") {
                History.clearAll(this)
                toast("История очищена")
            }
        })
    }

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(iconButton(R.drawable.ic_back, "Назад") { finish() },
            LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(TextView(context).apply {
            text = "Настройки"
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(dp(4), 0, 0, 0)
        })
    }

    // Смена темы пересоздаёт экраны с новыми цветами.
    private fun themeSelector() =
        segmented(Settings.Theme.values().toList(), Settings.theme(this), { it.title }) {
            Settings.setTheme(this, it)
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
                text = "От ${Settings.MIN_PROFILES} до ${Settings.MAX_PROFILES}. При уменьшении данные скрытых профилей сохраняются."
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
                hint = "Профиль $id"
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

    private fun renderPins() {
        pins.removeAllViews()
        val list = Pins.all(this)
        list.forEachIndexed { index, pin ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
                setPadding(dp(12), dp(6), dp(6), dp(6))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(6) }
                setOnClickListener { editPinDialog(pin) }
            }
            row.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(context).apply {
                    text = pin.title
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Ui.TEXT)
                    maxLines = 1
                })
                addView(TextView(context).apply {
                    text = if (pin.url == Pins.START) "Стартовая страница" else pin.url
                    textSize = 12f
                    setTextColor(Ui.MUTED)
                    maxLines = 1
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            // Стрелки порядка и удаление.
            row.addView(arrow("\u2191", index > 0) { Pins.move(this, pin.id, -1); renderPins() })
            row.addView(arrow("\u2193", index < list.size - 1) { Pins.move(this, pin.id, 1); renderPins() })
            row.addView(arrow("\u2715", list.size > 1) {
                Pins.remove(this, pin.id); renderPins()
            })
            pins.addView(row)
        }
    }

    private fun arrow(symbol: String, enabled: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = symbol
        textSize = 18f
        gravity = Gravity.CENTER
        setTextColor(if (enabled) Ui.TEXT else Ui.MUTED)
        alpha = if (enabled) 1f else 0.3f
        layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
        isEnabled = enabled
        if (enabled) setOnClickListener { onClick() }
    }

    private fun editPinDialog(pin: Pin?) {
        val title = EditText(this).apply {
            hint = "Название, напр. Gmail"
            setText(pin?.title ?: "")
            setSingleLine()
            setTextColor(Ui.TEXT)
        }
        val url = EditText(this).apply {
            hint = "Адрес, напр. mail.google.com"
            setText(pin?.url ?: "https://")
            setSingleLine()
            setTextColor(Ui.TEXT)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(title)
            addView(url, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(8) })
        }
        AlertDialog.Builder(this)
            .setTitle(if (pin == null) "Новая вкладка" else "Изменить вкладку")
            .setView(box)
            .setPositiveButton("Сохранить") { _, _ ->
                val t = title.text.toString().ifBlank { "Вкладка" }
                val u = url.text.toString()
                if (pin == null) Pins.add(this, t, u) else Pins.update(this, pin.id, t, u)
                renderPins()
            }
            .setNegativeButton("Отмена", null)
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
            .setPositiveButton("Очистить") { _, _ -> onYes() }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
