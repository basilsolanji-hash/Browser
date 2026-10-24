package ru.multibrowser

import android.content.Context

/**
 * Первый запуск: обучение и профили-примеры («Личное», «Работа», «Покупки», «Соцсети») со своими вкладками.
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

    /** Типовой набор для нового пользователя: личное, работа, покупки, соцсети — со своими вкладками. */
    private fun seedExamples(ctx: Context) {
        val start = Pin("start", "Старт", Pins.START)
        // Названия — ключами перевода («@…»): примеры меняют язык вместе с интерфейсом.
        val mail = Pin("mail", "@tab_mail", "https://mail.google.com/")
        val calendar = Pin("calendar", "@tab_calendar", "https://calendar.google.com/")
        listOf(
            Triple("ex_personal", listOf(start, mail), 1),
            Triple("ex_work", listOf(start, mail, calendar), 2),
            Triple("ex_shopping", listOf(start), 3),
            Triple("ex_social", listOf(start), 4),
        ).forEach { (key, pins, id) ->
            if (id > Settings.profileCount(ctx)) return@forEach
            Profiles.rename(ctx, id, "@${key}_name")
            Profiles.setDescription(ctx, id, "@${key}_desc")
            Pins.save(ctx, pins, id)
        }
    }
}
