package ru.multibrowser

/** Решение о выгрузке без зависимости от движка: порядок ключей — от старых к новым. */
internal object SessionRetention {
    fun evictionCandidate(
        oldestFirst: List<String>,
        lastByProfile: Set<String>,
        isSignIn: (String) -> Boolean,
    ): String? = oldestFirst.firstOrNull { it !in lastByProfile && !isSignIn(it) }
}
