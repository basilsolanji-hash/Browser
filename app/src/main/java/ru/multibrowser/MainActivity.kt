package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Главный экран: список из 15 профилей. Нажатие — открыть, долгое нажатие — меню профиля. */
class MainActivity : AppCompatActivity() {

    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Ui.init(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(24))
        }
        val root = ScrollView(this).apply {
            setBackgroundColor(Ui.BG)
            isFillViewport = true
            addView(list)
        }
        setContentView(root)
        applyEdgeToEdge(root)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        list.removeAllViews()

        list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_wordmark)
                contentDescription = "Ось"
                scaleType = ImageView.ScaleType.FIT_START
            }, LinearLayout.LayoutParams(0, dp(34), 1f))
            addView(iconButton(R.drawable.ic_settings, "Настройки") {
                startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
            }, LinearLayout.LayoutParams(dp(40), dp(40)))
        })
        list.addView(TextView(this).apply {
            text = "Профили"
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(0, dp(20), 0, dp(6))
        })
        list.addView(TextView(this).apply {
            text = "${Settings.profileCount(this@MainActivity)} изолированных профилей: в каждом свой Gmail и свой Claude. Долгое нажатие — меню профиля."
            textSize = 13f
            setTextColor(Ui.MUTED)
            setPadding(0, 0, 0, dp(12))
        })
        Profiles.all(this).forEach { list.addView(row(it)) }
    }

    private fun row(p: Profile): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(62)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8) }
            setOnClickListener { openSite(p, null) }
            setOnLongClickListener { profileMenu(p); true }
        }

        // Цветная полоска слева — как акцентная граница у полей knitERP.
        row.addView(View(this).apply { setBackgroundColor(p.color) },
            LinearLayout.LayoutParams(dp(3), LinearLayout.LayoutParams.MATCH_PARENT))

        row.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(8), dp(10))
            addView(TextView(context).apply {
                text = p.name
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            })
            addView(TextView(context).apply {
                text = p.email ?: "Вход не выполнен"
                textSize = 13f
                setTextColor(Ui.MUTED)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        if (Gecko.isActive(p.id)) {
            row.addView(View(this).apply { background = Ui.oval(Ui.ACCENT) },
                LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) })
        }
        val gmail = if (p.unread > 0) "Gmail · ${if (p.unread > 999) "999+" else p.unread}" else "Gmail"
        row.addView(pill(gmail, p.unread > 0) { openSite(p, Site.GMAIL) })
        row.addView(pill("Claude", false) { openSite(p, Site.CLAUDE) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(32)).apply {
                marginStart = dp(6)
                marginEnd = dp(12)
            })
        return row
    }

    private fun openSite(p: Profile, site: Site?) {
        val intent = Intent(this, BrowserActivity::class.java).putExtra(BrowserActivity.EXTRA_PROFILE, p.id)
        site?.let { intent.putExtra(BrowserActivity.EXTRA_SITE, it.name) }
        startActivity(intent)
    }

    /** Кнопка-«пилюля» быстрого входа во вкладку; акцентная — если есть непрочитанные. */
    private fun pill(label: String, highlight: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 12f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(if (highlight) Ui.ON_ACCENT else Ui.TEXT)
        background = if (highlight) Ui.rounded(Ui.ACCENT, dpf(5)) else Ui.rounded(Ui.BG, dpf(5), dp(1))
        setPadding(dp(10), 0, dp(10), 0)
        minHeight = dp(32)
        setOnClickListener { onClick() }
    }

    private fun profileMenu(p: Profile) {
        AlertDialog.Builder(this)
            .setTitle(p.name)
            .setItems(arrayOf("Переименовать", "Выйти из аккаунтов (очистить профиль)")) { _, which ->
                if (which == 0) renameDialog(p) else clearDialog(p)
            }
            .show()
    }

    private fun renameDialog(p: Profile) {
        val input = EditText(this).apply {
            setText(p.name)
            setSingleLine()
            setTextColor(Ui.TEXT)
        }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(this)
            .setTitle("Название профиля")
            .setView(box)
            .setPositiveButton("Сохранить") { _, _ ->
                if (input.text.isNotBlank()) Profiles.rename(this, p.id, input.text.toString())
                render()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun clearDialog(p: Profile) {
        AlertDialog.Builder(this)
            .setTitle("Очистить «${p.name}»?")
            .setMessage("Будут удалены вход в аккаунты, cookies и данные сайтов этого профиля. Другие профили не пострадают.")
            .setPositiveButton("Очистить") { _, _ ->
                Gecko.clearProfile(this, p.id)
                render()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }
}
