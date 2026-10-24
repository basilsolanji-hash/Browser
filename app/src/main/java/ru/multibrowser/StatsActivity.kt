package ru.multibrowser

import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.format.Formatter
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** «Статистика» в настройках: что и сколько в Оси — по данным только этого устройства. */
class StatsActivity : AppCompatActivity() {

    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        content = ExtrasUi.screen(this)
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    private fun render() {
        content.removeAllViews()
        content.addView(ExtrasUi.header(this, Tr.t("stats")))
        val profiles = Profiles.all(this)
        val pages = profiles.associate { it.id to Stats.pages(this, it.id) }
        val date = SimpleDateFormat("d MMMM yyyy", Locale.getDefault()).format(Date(Stats.since(this)))

        // Крупные цифры: страницы и трекеры.
        content.addView(LinearLayout(this).apply {
            setPadding(0, dp(12), 0, 0)
            addView(tile(pages.values.sum().toString(), Tr.t("stats_pages")),
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) })
            addView(tile(Stats.trackers(this@StatsActivity).toString(), Tr.t("stats_trackers")),
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        })
        content.addView(ExtrasUi.hint(this, Tr.t("stats_since", date)))

        // По профилям — полоска пропорционально числу страниц.
        content.addView(sectionTitle(Tr.t("profiles")))
        val max = pages.values.maxOrNull()?.coerceAtLeast(1) ?: 1
        profiles.filter { (pages[it.id] ?: 0) > 0 || it.id <= 4 }.forEach { p ->
            content.addView(profileBar(p, pages[p.id] ?: 0, max))
        }

        // Частые сайты — по истории всех профилей.
        val hosts = profiles.flatMap { History.list(this, it.id) }
            .mapNotNull { Uri.parse(it.url).host?.removePrefix("www.") }
            .groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(5)
        content.addView(sectionTitle(Tr.t("stats_top_sites")))
        if (hosts.isEmpty()) content.addView(ExtrasUi.hint(this, Tr.t("stats_no_sites")))
        hosts.forEach { (host, n) -> content.addView(ExtrasUi.card(this, host, Tr.t("stats_visits", n))) }

        // Библиотека.
        content.addView(sectionTitle(Tr.t("my_library")))
        val saved = SavedPages.list(this)
        val files = profiles.flatMap { ProfileFiles.list(this, it.id) }
        content.addView(ExtrasUi.card(this, Tr.t("notes"), Notes.list(this).size.toString()))
        content.addView(ExtrasUi.card(this, Tr.t("saved_pages"),
            "${saved.size} · ${Formatter.formatShortFileSize(this, saved.sumOf { it.size })}"))
        content.addView(ExtrasUi.card(this, Tr.t("downloads"), DownloadLog.list(this).size.toString()))
        content.addView(ExtrasUi.card(this, Tr.t("profile_files"),
            "${files.size} · ${Formatter.formatShortFileSize(this, files.sumOf { it.length() })}"))

        content.addView(ExtrasUi.button(this, Tr.t("stats_reset")) {
            AlertDialog.Builder(this)
                .setTitle(Tr.t("stats_reset_q"))
                .setPositiveButton(Tr.t("stats_reset")) { _, _ -> Stats.reset(this); render() }
                .setNegativeButton(Tr.t("cancel"), null)
                .show()
        })
        content.addView(ExtrasUi.hint(this, Tr.t("stats_local")))
    }

    private fun tile(value: String, label: String) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setPadding(dp(14), dp(12), dp(14), dp(12))
        addView(TextView(context).apply {
            text = value
            textSize = 26f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
        })
        addView(TextView(context).apply {
            text = label
            textSize = 12f
            setTextColor(Ui.MUTED)
        })
    }

    private fun profileBar(p: Profile, n: Int, max: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(0, dp(6), 0, dp(2))
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(View(context).apply { background = Ui.oval(p.color) }, LinearLayout.LayoutParams(dp(10), dp(10)))
            addView(TextView(context).apply {
                text = p.name
                textSize = 14f
                setTextColor(Ui.TEXT)
                setPadding(dp(8), 0, 0, 0)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(context).apply {
                text = n.toString()
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
            })
        })
        addView(LinearLayout(context).apply {
            background = Ui.rounded(Ui.SURFACE, dpf(3))
            addView(View(context).apply { background = Ui.rounded(p.color, dpf(3)) },
                LinearLayout.LayoutParams(0, dp(6), n.toFloat().coerceAtLeast(0.001f)))
            addView(View(context), LinearLayout.LayoutParams(0, dp(6), (max - n).toFloat().coerceAtLeast(0.001f)))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(6)).apply { topMargin = dp(6) })
    }
}
