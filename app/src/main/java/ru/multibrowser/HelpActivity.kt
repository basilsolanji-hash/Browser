package ru.multibrowser

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** «Справка и отзывы» (№25): ответы на частые вопросы и письмо разработчику. Своего сервера нет — только почта. */
class HelpActivity : AppCompatActivity() {

    companion object {
        /** Адрес для отзывов — из docs/privacy.html (контакт разработчика). Поменять здесь при смене. */
        const val FEEDBACK_EMAIL = "moonstar20moon19@gmail.com"
        private const val TOPICS = 6
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        val content = ExtrasUi.screen(this)
        content.addView(ExtrasUi.header(this, Tr.t("help_feedback")))

        content.addView(sectionTitle(Tr.t("feedback")))
        content.addView(ExtrasUi.button(this, Tr.t("send_feedback")) { mail(Tr.t("feedback_subject", AppInfo.version(this)), "") })
        content.addView(ExtrasUi.button(this, Tr.t("report_problem")) {
            mail(Tr.t("problem_subject", AppInfo.version(this)), Tr.t("problem_body") + "\n\n\n—\n" + deviceInfo())
        })
        content.addView(ExtrasUi.hint(this, Tr.t("feedback_desc", FEEDBACK_EMAIL)))

        content.addView(sectionTitle(Tr.t("help")))
        content.addView(ExtrasUi.button(this, Tr.t("onb_again")) {
            startActivity(Intent(this, OnboardingActivity::class.java))
        })
        (1..TOPICS).forEach { i ->
            content.addView(ExtrasUi.card(this, Tr.t("help_q$i"), Tr.t("help_a$i")))
        }
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
    }

    /** Только то, что помогает разобрать проблему; адресов страниц и данных профилей не прикладываем. */
    private fun deviceInfo() = "Ось Browser ${AppInfo.version(this)}, GeckoView ${AppInfo.engine()}\n" +
        "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}"

    private fun mail(subject: String, body: String) {
        val uri = Uri.parse("mailto:$FEEDBACK_EMAIL?subject=${Uri.encode(subject)}&body=${Uri.encode(body)}")
        val intent = Intent(Intent.ACTION_SENDTO, uri).apply {
            putExtra(Intent.EXTRA_EMAIL, arrayOf(FEEDBACK_EMAIL))
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            // Нет почтового приложения — показываем адрес, чтобы написать с любого устройства.
            AlertDialog.Builder(this)
                .setTitle(Tr.t("feedback"))
                .setMessage(Tr.t("no_mail_app", FEEDBACK_EMAIL))
                .setPositiveButton(Tr.t("copy")) { _, _ -> copyText("email", FEEDBACK_EMAIL) }
                .setNegativeButton(Tr.t("close"), null)
                .show()
        }
    }
}
