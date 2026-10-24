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
        content.addView(sectionTitle("Тема"))
        content.addView(themeSelector())
        content.addView(sectionTitle("Адресная строка и вкладки"))
        content.addView(segmented(Settings.BarPosition.values().toList(), Settings.barPosition(this), { it.title }) {
            Settings.setBarPosition(this, it)
            recreate()
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
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                background = if (selected) Ui.rounded(Ui.ACCENT, dpf(5)) else null
                setTextColor(if (selected) Ui.ON_ACCENT else Ui.MUTED)
                setOnClickListener { if (!selected) onPick(option) }
            }, LinearLayout.LayoutParams(0, dp(38), 1f))
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
