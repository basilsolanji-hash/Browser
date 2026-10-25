package ru.multibrowser

import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * «Удалить данные о работе в браузере» — как в Chrome: временной диапазон и карточки с галочками
 * (история, cookies и данные сайтов, кеш, вкладки, пароли, настройки сайтов) с числом записей.
 */
class ClearDataActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"

        /** Диапазоны: ключ подписи и длительность в мс (0 — всё время). */
        val RANGES = listOf(
            "range_15m" to 15 * 60_000L, "range_1h" to 3_600_000L, "range_24h" to 86_400_000L,
            "range_7d" to 7 * 86_400_000L, "range_4w" to 28 * 86_400_000L, "range_all" to 0L,
        )
    }

    private var profile = 1
    private var range = RANGES.lastIndex
    private lateinit var list: LinearLayout
    // История, cookies, кеш, вкладки — по умолчанию да; пароли и настройки сайтов — нет.
    private val checked = booleanArrayOf(true, true, true, true, false, false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        profile = intent.getIntExtra(EXTRA_PROFILE, Profiles.lastProfile(this)).coerceIn(1, Settings.profileCount(this))
        list = ExtrasUi.screen(this)
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    private fun since(): Long = RANGES[range].second.let { if (it == 0L) 0L else System.currentTimeMillis() - it }

    private fun render() {
        list.removeAllViews()
        list.addView(ExtrasUi.header(this, Tr.t("clear_browsing_data")))
        list.addView(ExtrasUi.hint(this, Profiles.get(this, profile).name))
        list.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(12), 0, dp(12))
            addView(TextView(context).apply { text = Tr.t("time_range"); textSize = 16f; setTextColor(Ui.TEXT) },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(context).apply {
                text = Tr.t(RANGES[range].first) + "  ▾"
                textSize = 16f
                setTextColor(Ui.TEXT)
                contentDescription = Tr.t("time_range")
                setPadding(dp(12), dp(10), dp(4), dp(10))
                setOnClickListener {
                    AlertDialog.Builder(this@ClearDataActivity)
                        .setSingleChoiceItems(RANGES.map { Tr.t(it.first) }.toTypedArray(), range) { d, i -> range = i; d.dismiss(); render() }
                        .show()
                }
            })
        })
        val s = since()
        val history = History.countSince(this, profile, s)
        val tabs = Tabs.count(this, profile)
        val passwords = Passwords.list(this, profile).count { s == 0L || it.time >= s }
        val sites = SitePermissions.sites(this).size
        val items = listOf(
            Triple(R.drawable.ic_history, Tr.t("history"), Tr.t("cd_history_n", history)),
            Triple(R.drawable.ic_shield, Tr.t("cd_cookies"), Tr.t("cd_cookies_desc")),
            Triple(R.drawable.ic_image, Tr.t("cd_cache"), Tr.t("cd_cache_desc")),
            Triple(R.drawable.ic_tabs, Tr.t("tabs"), Tr.t("cd_tabs_n", tabs)),
            Triple(R.drawable.ic_lock, Tr.t("passwords"), Tr.t("cd_passwords_n", passwords)),
            Triple(R.drawable.ic_settings, Tr.t("site_settings"), Tr.t("cd_sites_n", sites)),
        )
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(16))
        }
        items.forEachIndexed { i, (icon, title, sub) ->
            if (i > 0) card.addView(View(this).apply { setBackgroundColor(Ui.BG) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(2)))
            val box = CheckBox(this).apply {
                isChecked = checked[i]
                contentDescription = title
                buttonTintList = android.content.res.ColorStateList.valueOf(Ui.ACCENT)
                setOnCheckedChangeListener { _, on -> checked[i] = on }
            }
            card.addView(LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16), dp(14), dp(8), dp(14))
                setOnClickListener { box.toggle() }
                addView(icon(icon, Ui.TEXT, 24))
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(18), 0, dp(8), 0)
                    addView(TextView(context).apply { text = title; textSize = 16f; setTextColor(Ui.TEXT) })
                    addView(TextView(context).apply { text = sub; textSize = 13f; setTextColor(Ui.MUTED) })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(box)
            })
        }
        list.addView(card)
        list.addView(ExtrasUi.hint(this, Tr.t("cd_note")))
        list.addView(ExtrasUi.button(this, Tr.t("cd_delete")) { clear() }.apply {
            background = Ui.rounded(Ui.ACCENT, dpf(24))
            setTextColor(Ui.ON_ACCENT)
        })
    }

    private fun clear() {
        val s = since()
        if (checked[0]) History.clearSince(this, profile, s)
        // Cookies и данные сайтов — для всего профиля (движок не умеет удалять их за период).
        if (checked[1]) {
            Gecko.dropProfileSessions(profile)
            Gecko.runtime(this).storageController.clearDataForSessionContext("profile_$profile")
        }
        if (checked[2]) Gecko.clearCache(this)
        if (checked[3]) {
            Tabs.list(this, profile).forEach { Gecko.close(profile, it.id) }
            Tabs.closeAll(this, profile)
        }
        if (checked[4]) Passwords.removeSince(this, profile, s)
        if (checked[5]) SitePermissions.clearAll(this)
        Toast.makeText(this, Tr.t("done"), Toast.LENGTH_SHORT).show()
        finish()
    }
}
