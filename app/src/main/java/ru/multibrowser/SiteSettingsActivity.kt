package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import ru.multibrowser.SitePermissions.Kind
import ru.multibrowser.SitePermissions.Mode

/**
 * Настройки сайтов: значения по умолчанию для каждого типа разрешений и список сайтов
 * с сохранёнными решениями. С экстрой [SitePermissions.EXTRA_HOST] — настройки одного сайта.
 */
class SiteSettingsActivity : AppCompatActivity() {

    private lateinit var content: LinearLayout
    private var host: String? = null

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        host = intent.getStringExtra(SitePermissions.EXTRA_HOST)?.takeIf { it.isNotBlank() }
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

    private fun render() {
        content.removeAllViews()
        val site = host
        content.addView(header(site ?: Tr.t("site_settings")))
        if (site != null) renderSite(site) else renderAll()
    }

    // --- Один сайт ---

    private fun renderSite(site: String) {
        content.addView(sectionTitle(Tr.t("site_permissions")))
        Kind.values().forEach { kind ->
            val saved = SitePermissions.get(this, site, kind)
            content.addView(card().apply {
                addView(label(Tr.t(kind.titleKey)))
                val default = SitePermissions.defaultMode(this@SiteSettingsActivity, kind)
                addView(segmented(listOf<Mode?>(null, Mode.ALLOW, Mode.BLOCK), saved, {
                    if (it == null) Tr.t("perm_by_default", modeLabel(default)) else modeLabel(it)
                }) {
                    SitePermissions.set(this@SiteSettingsActivity, site, kind, it)
                    render()
                }, matchWrap().apply { topMargin = dp(8) })
            })
        }
        content.addView(hint(Tr.t("perm_site_desc")))
        content.addView(button(Tr.t("perm_reset_site")) {
            SitePermissions.clearSite(this, site)
            render()
        })
        content.addView(button(Tr.t("perm_all_sites")) {
            startActivity(Intent(this, SiteSettingsActivity::class.java))
        })
    }

    // --- Все сайты ---

    private fun renderAll() {
        content.addView(sectionTitle(Tr.t("perm_defaults")))
        Kind.values().forEach { kind ->
            content.addView(card().apply {
                addView(label(Tr.t(kind.titleKey)))
                addView(segmented(kind.defaults, SitePermissions.defaultMode(this@SiteSettingsActivity, kind), { modeLabel(it) }) {
                    SitePermissions.setDefault(this@SiteSettingsActivity, kind, it)
                    render()
                }, matchWrap().apply { topMargin = dp(8) })
            })
        }
        content.addView(hint(Tr.t("perm_defaults_desc")))

        content.addView(sectionTitle(Tr.t("perm_sites")))
        val sites = SitePermissions.sites(this)
        if (sites.isEmpty()) {
            content.addView(TextView(this).apply {
                text = Tr.t("perm_no_sites")
                textSize = 14f
                setTextColor(Ui.MUTED)
                gravity = Gravity.CENTER
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
                setPadding(dp(16), dp(20), dp(16), dp(20))
            }, matchWrap().apply { topMargin = dp(6) })
            return
        }
        sites.forEach { (site, perms) ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
                setPadding(dp(12), dp(8), dp(4), dp(8))
                setOnClickListener {
                    startActivity(Intent(this@SiteSettingsActivity, SiteSettingsActivity::class.java)
                        .putExtra(SitePermissions.EXTRA_HOST, site))
                }
            }
            row.addView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                addView(TextView(context).apply {
                    text = site
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Ui.TEXT)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(TextView(context).apply {
                    text = perms.entries.joinToString(" · ") { (k, m) -> "${Tr.t(k.titleKey)}: ${modeLabel(m)}" }
                    textSize = 12f
                    setTextColor(Ui.MUTED)
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(TextView(this).apply {
                text = "✕"
                textSize = 18f
                gravity = Gravity.CENTER
                setTextColor(Ui.TEXT)
                contentDescription = Tr.t("perm_reset_site")
                setOnClickListener {
                    SitePermissions.clearSite(this@SiteSettingsActivity, site)
                    render()
                }
            }, LinearLayout.LayoutParams(dp(44), dp(44)))
            content.addView(row, matchWrap().apply { topMargin = dp(6) })
        }
        content.addView(button(Tr.t("perm_reset_all")) {
            AlertDialog.Builder(this)
                .setTitle(Tr.t("perm_reset_all_q"))
                .setPositiveButton(Tr.t("reset")) { _, _ ->
                    SitePermissions.clearAll(this)
                    render()
                }
                .setNegativeButton(Tr.t("cancel"), null)
                .show()
        })
    }

    // --- Элементы ---

    private fun modeLabel(mode: Mode) = when (mode) {
        Mode.ASK -> Tr.t("perm_ask")
        Mode.ALLOW -> Tr.t("perm_allow")
        Mode.BLOCK -> Tr.t("perm_block")
    }

    private fun header(title: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(iconButton(R.drawable.ic_back, Tr.t("back")) { finish() },
            LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(TextView(context).apply {
            text = title
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(8), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun matchWrap() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
    )

    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setPadding(dp(12), dp(10), dp(12), dp(10))
        layoutParams = matchWrap().apply { topMargin = dp(6) }
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(Ui.TEXT)
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

    /** Сегментированный переключатель — как в основных настройках. */
    private fun <T> segmented(options: List<T>, current: T, label: (T) -> String, onPick: (T) -> Unit): View {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = Ui.rounded(Ui.BG, dpf(6), dp(1))
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        options.forEach { option ->
            val selected = option == current
            bar.addView(TextView(this).apply {
                text = label(option)
                textSize = 12.5f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                maxLines = 2
                minHeight = dp(38)
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
}
