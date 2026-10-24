package ru.multibrowser

import android.content.Context

/**
 * Первый запуск: обучение и профили-примеры «Моя почта» и «Моя компания» со своими вкладками.
 * Примеры создаются только на чистой установке — у тех, кто уже пользуется Осью, ничего не меняем.
 */
object Onboarding {
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("onboarding", Context.MODE_PRIVATE)

    fun done(ctx: Context) = prefs(ctx).getBoolean("done", false)

    fun finish(ctx: Context) {
        prefs(ctx).edit().putBoolean("done", true).apply()
    }

    /** Нужно ли показать обучение. Обновление со старой версии (есть свои данные) — без обучения. */
    fun shouldShow(ctx: Context): Boolean {
        if (done(ctx)) return false
        val fresh = ctx.getSharedPreferences("profiles", Context.MODE_PRIVATE).all.isEmpty() &&
            ctx.getSharedPreferences("pins", Context.MODE_PRIVATE).all.isEmpty()
        if (!fresh) {
            finish(ctx)
            return false
        }
        seedExamples(ctx)
        return true
    }

    private fun seedExamples(ctx: Context) {
        val start = Pin("start", "Старт", Pins.START)
        Profiles.rename(ctx, 1, Tr.t("ex_mail_name"))
        Profiles.setDescription(ctx, 1, Tr.t("ex_mail_desc"))
        Pins.save(ctx, listOf(start, Pin("mail", Tr.t("tab_mail"), "https://mail.google.com/")), 1)
        if (Settings.profileCount(ctx) >= 2) {
            Profiles.rename(ctx, 2, Tr.t("ex_company_name"))
            Profiles.setDescription(ctx, 2, Tr.t("ex_company_desc"))
            Pins.save(ctx, listOf(start, Pin("mail", Tr.t("tab_mail"), "https://mail.google.com/")), 2)
        }
    }
}
