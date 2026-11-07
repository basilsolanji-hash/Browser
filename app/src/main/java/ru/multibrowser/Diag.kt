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
        val safeTab = redact(tab)
        val safeMessage = redact(message)
        Log.i("OsDiag", "[$safeTab] $safeMessage")
        lines.addFirst("${fmt.format(Date())} [$safeTab] $safeMessage")
        while (lines.size > MAX) lines.removeLast()
    }

    private val addresses = Regex("[A-Za-z][A-Za-z0-9+.-]*:[^\\s<>]+")
    private val emails = Regex("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", RegexOption.IGNORE_CASE)

    /** Keep only routing origin; OAuth codes, credentials, intent extras and page paths stay out of logcat. */
    internal fun redact(message: String): String = emails.replace(addresses.replace(message) { match ->
        val uri = android.net.Uri.parse(match.value)
        val scheme = uri.scheme?.lowercase(Locale.ROOT).orEmpty()
        if (scheme in setOf("http", "https")) {
            val host = uri.host?.takeIf { it.isNotBlank() && it.none { c -> c.isWhitespace() || c.code < 0x20 } }
            if (host == null) "$scheme:[redacted]" else "$scheme://$host"
        } else "$scheme:[redacted]"
    }, "[redacted]")

    @Synchronized
    fun text(): String = if (lines.isEmpty()) Tr.t("no_events") else lines.joinToString("\n")
}
