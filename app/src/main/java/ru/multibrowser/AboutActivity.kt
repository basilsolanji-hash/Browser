package ru.multibrowser

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.pm.PackageInfoCompat
import org.mozilla.geckoview.GeckoSession

/** Версии приложения и движка — для «О приложении» и письма в поддержку. */
object AppInfo {
    /** Политика конфиденциальности (docs/privacy.html, опубликована на GitHub Pages — см. docs/PLAY_RELEASE.md). */
    const val PRIVACY_URL = "https://basilsolanji-hash.github.io/Browser/privacy.html"

    fun version(ctx: Context): String = runCatching {
        val info = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        "${info.versionName} (${PackageInfoCompat.getLongVersionCode(info)})"
    }.getOrDefault("?")

    /** Версия Firefox, на которой собран GeckoView (из его стандартного User-Agent). */
    fun engine(): String = runCatching {
        Regex("Firefox/([0-9.]+)").find(GeckoSession.getDefaultUserAgent())?.groupValues?.get(1)
    }.getOrNull() ?: "?"
}

/**
 * «О приложении» (№23): версия, движок, лицензии, политика конфиденциальности.
 * Раздела «Другие продукты» нет: других опубликованных продуктов у разработчика пока нет,
 * выдумывать их нельзя — добавить сюда, когда появятся.
 */
class AboutActivity : AppCompatActivity() {

    private data class License(val name: String, val license: String, val url: String)

    private val licenses = listOf(
        License("GeckoView (Mozilla Firefox)", "Mozilla Public License 2.0", "https://www.mozilla.org/MPL/2.0/"),
        License("AndroidX: Core, AppCompat, Biometric, SwipeRefreshLayout", "Apache License 2.0",
            "https://www.apache.org/licenses/LICENSE-2.0"),
        License("Kotlin Standard Library", "Apache License 2.0", "https://www.apache.org/licenses/LICENSE-2.0"),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        val content = ExtrasUi.screen(this)
        content.addView(ExtrasUi.header(this, Tr.t("about")))

        content.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(28), 0, dp(8))
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_wordmark)
                scaleType = ImageView.ScaleType.FIT_CENTER
            }, LinearLayout.LayoutParams(dp(200), dp(60)))
            addView(ExtrasUi.paragraph(context, Tr.t("start_tagline"), 12f, Ui.MUTED, bold = true).apply {
                gravity = Gravity.CENTER
                letterSpacing = 0.14f
                setPadding(0, dp(10), 0, 0)
            })
        })
        content.addView(ExtrasUi.paragraph(this, Tr.t("about_desc")).apply { gravity = Gravity.CENTER })

        content.addView(sectionTitle(Tr.t("about_section")))
        content.addView(ExtrasUi.card(this, Tr.t("version", AppInfo.version(this)), Tr.t("engine", AppInfo.engine())))

        content.addView(sectionTitle(Tr.t("privacy_security")))
        content.addView(ExtrasUi.paragraph(this, Tr.t("about_privacy"), 13f, Ui.MUTED))
        content.addView(ExtrasUi.button(this, Tr.t("privacy_policy")) { openPage(AppInfo.PRIVACY_URL) })

        content.addView(sectionTitle(Tr.t("licenses")))
        licenses.forEach { l ->
            content.addView(ExtrasUi.card(this, l.name, l.license) { openPage(l.url) })
        }
        content.addView(ExtrasUi.hint(this, Tr.t("licenses_desc")))
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
    }

    private fun openPage(url: String) {
        startActivity(Intent(this, BrowserActivity::class.java).putExtra(BrowserActivity.EXTRA_URL, url))
    }
}
