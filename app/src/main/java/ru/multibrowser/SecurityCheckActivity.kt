package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * «Проверка безопасности» (№31): понятные пункты со статусом и кнопкой «Исправить»,
 * итоговая оценка. Всё считается на устройстве.
 */
class SecurityCheckActivity : AppCompatActivity() {

    private enum class Status { OK, INFO, WARN }

    private class Check(
        val title: String,
        val detail: String,
        val status: Status,
        val action: String? = null,
        val onAction: (() -> Unit)? = null,
    )

    private lateinit var content: LinearLayout

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        content = LinearLayout(this).apply {
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
    }

    private fun checks(): List<Check> {
        val list = mutableListOf<Check>()

        // Блокировка приложения.
        val lockOn = Settings.lockEnabled(this)
        val deviceSecure = AppLock.deviceSecure(this)
        list += when {
            lockOn && deviceSecure -> Check(Tr.t("sec_lock"), Tr.t("sec_lock_ok"), Status.OK)
            !deviceSecure -> Check(Tr.t("sec_lock"), Tr.t("sec_lock_no_device"), Status.WARN, Tr.t("sec_fix")) {
                runCatching { startActivity(Intent(android.provider.Settings.ACTION_SECURITY_SETTINGS)) }
            }
            else -> Check(Tr.t("sec_lock"), Tr.t("sec_lock_off"), Status.WARN, Tr.t("sec_fix")) {
                Settings.setLockEnabled(this, true)
                render()
            }
        }

        // Скрытие содержимого.
        list += if (Settings.hideContent(this)) {
            Check(Tr.t("sec_hide"), Tr.t("sec_hide_ok"), Status.OK)
        } else {
            Check(Tr.t("sec_hide"), Tr.t("sec_hide_off"), Status.WARN, Tr.t("sec_fix")) {
                Settings.setHideContent(this, true)
                AppLock.onResume(this)
                render()
            }
        }

        // Защита от трекеров — стандартный уровень всегда включён (см. Gecko.runtime).
        list += Check(Tr.t("sec_tracking"), Tr.t("sec_tracking_ok"), Status.OK)

        // HTTPS.
        list += if (Settings.httpsOnly(this)) {
            Check(Tr.t("sec_https"), Tr.t("sec_https_ok"), Status.OK)
        } else {
            Check(Tr.t("sec_https"), Tr.t("sec_https_off"), Status.WARN, Tr.t("sec_fix")) {
                Settings.setHttpsOnly(this, true)
                render()
            }
        }

        // Поисковик.
        val engine = Search.current(this)
        list += if (engine.id in PRIVATE_ENGINES) {
            Check(Tr.t("search_engine"), Tr.t("sec_search_ok", engine.title), Status.OK)
        } else {
            Check(Tr.t("search_engine"), Tr.t("sec_search_bad", engine.title), Status.WARN, Tr.t("sec_fix")) {
                Search.set(this, "ddg")
                render()
            }
        }

        // Разрешения сайтов: выданные доступы — не ошибка, но их стоит просмотреть.
        val (count, sites) = SitePermissions.granted(this, SitePermissions.SENSITIVE)
        val openSites = { startActivity(Intent(this, SiteSettingsActivity::class.java)) }
        list += if (count == 0) {
            Check(Tr.t("site_permissions"), Tr.t("sec_perms_ok"), Status.OK, Tr.t("sec_review"), openSites)
        } else {
            Check(Tr.t("site_permissions"), Tr.t("sec_perms_n", count, sites), Status.INFO, Tr.t("sec_review"), openSites)
        }
        return list
    }

    private fun render() {
        content.removeAllViews()
        content.addView(header())
        val list = checks()
        val passed = list.count { it.status != Status.WARN }
        content.addView(summary(passed, list.size))
        content.addView(sectionTitle(Tr.t("sec_items")))
        list.forEach { content.addView(item(it)) }
        content.addView(TextView(this).apply {
            text = Tr.t("sec_local_note")
            textSize = 12f
            setTextColor(Ui.MUTED)
            setPadding(0, dp(12), 0, 0)
        })
    }

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(iconButton(R.drawable.ic_back, Tr.t("back")) { finish() },
            LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(TextView(context).apply {
            text = Tr.t("security_check")
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(dp(8), 0, 0, 0)
        })
    }

    /** Итоговая оценка: кольцо со счётом и короткий вывод. */
    private fun summary(passed: Int, total: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = Ui.rounded(Ui.SURFACE, dpf(8), dp(1))
        setPadding(dp(16), dp(16), dp(16), dp(16))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(16) }
        val all = passed == total
        addView(FrameLayout(context).apply {
            background = Ui.oval(if (all) Ui.ACCENT else Ui.BG, dp(3), Ui.ACCENT)
            addView(TextView(context).apply {
                text = "$passed/$total"
                textSize = 20f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(if (all) Ui.ON_ACCENT else Ui.TEXT)
            }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }, LinearLayout.LayoutParams(dp(72), dp(72)))
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), 0, 0, 0)
            addView(TextView(context).apply {
                text = Tr.t(
                    when {
                        all -> "sec_good"
                        passed >= total - 2 -> "sec_fair"
                        else -> "sec_poor"
                    }
                )
                textSize = 17f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
            })
            addView(TextView(context).apply {
                text = Tr.t("sec_score", passed, total)
                textSize = 13f
                setTextColor(Ui.MUTED)
                setPadding(0, dp(4), 0, 0)
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun item(check: Check) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setPadding(dp(12), dp(12), dp(12), dp(12))
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(6) }

        // Значок статуса: ✓ — в порядке, i — к сведению, ! — требует внимания (акцентом).
        val warn = check.status == Status.WARN
        addView(TextView(context).apply {
            text = when (check.status) { Status.OK -> "✓"; Status.INFO -> "i"; Status.WARN -> "!" }
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(if (warn) Ui.ON_ACCENT else Ui.TEXT)
            background = if (warn) Ui.oval(Ui.ACCENT) else Ui.oval(Ui.BG, dp(1), Ui.BORDER)
        }, LinearLayout.LayoutParams(dp(30), dp(30)))

        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
            addView(TextView(context).apply {
                text = check.title
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
            })
            addView(TextView(context).apply {
                text = check.detail
                textSize = 12.5f
                setTextColor(Ui.MUTED)
                setPadding(0, dp(2), 0, 0)
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        if (check.action != null && check.onAction != null) {
            addView(TextView(context).apply {
                text = check.action
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setPadding(dp(12), 0, dp(12), 0)
                minWidth = dp(64)
                if (warn) {
                    setTextColor(Ui.ON_ACCENT)
                    background = Ui.rounded(Ui.ACCENT, dpf(6))
                } else {
                    setTextColor(Ui.TEXT)
                    background = Ui.rounded(Ui.BG, dpf(6), dp(1))
                }
                setOnClickListener { check.onAction.invoke() }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)))
        }
    }

    private companion object {
        /** Поисковики, не строящие профиль по запросам. */
        val PRIVATE_ENGINES = setOf("ddg", "startpage", "brave")
    }
}
