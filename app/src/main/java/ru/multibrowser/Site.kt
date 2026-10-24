package ru.multibrowser

/** Вкладки внутри профиля. Обе живут в одном контейнере, поэтому вход через Google работает и в Claude. */
enum class Site(val title: String, val home: String) {
    GMAIL("Gmail", "https://mail.google.com/"),
    CLAUDE("Claude", "https://claude.ai/"),
}
