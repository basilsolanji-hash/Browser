package ru.multibrowser

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Журнал событий загрузки страниц — показывается в меню «Диагностика», чтобы разбирать проблемы по скриншоту. */
object Diag {
    private const val MAX = 80
    private val lines = ArrayDeque<String>()
    private val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    @Synchronized
    fun log(tab: String, message: String) {
        Log.i("OsDiag", "[$tab] $message")
        lines.addFirst("${fmt.format(Date())} [$tab] $message")
        while (lines.size > MAX) lines.removeLast()
    }

    @Synchronized
    fun text(): String = if (lines.isEmpty()) Tr.t("no_events") else lines.joinToString("\n")
}
