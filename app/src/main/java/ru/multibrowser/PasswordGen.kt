package ru.multibrowser

import java.security.SecureRandom

/**
 * Генератор паролей (тот же набор правил, что и подсказка на сайтах в assets/pwgen): без похожих
 * символов (0/O, 1/l/I), обязательно строчная, заглавная и — по выбору — цифра и знак.
 */
object PasswordGen {
    private const val LOWER = "abcdefghijkmnopqrstuvwxyz"
    private const val UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    private const val DIGITS = "23456789"
    private const val SYMBOLS = "-_.!@#%+=?"
    private val random = SecureRandom()

    fun generate(length: Int = 16, digits: Boolean = true, symbols: Boolean = true): String {
        val sets = listOfNotNull(LOWER, UPPER, DIGITS.takeIf { digits }, SYMBOLS.takeIf { symbols })
        val len = length.coerceIn(sets.size.coerceAtLeast(8), 64)
        val all = sets.joinToString("")
        val out = sets.map { it[random.nextInt(it.length)] }.toMutableList()
        while (out.size < len) out += all[random.nextInt(all.length)]
        for (i in out.indices.reversed()) { val j = random.nextInt(i + 1); val t = out[i]; out[i] = out[j]; out[j] = t }
        return out.joinToString("")
    }

    /** Оценка надёжности: 0 — слабый … 3 — очень надёжный (длина и разнообразие символов). */
    fun strength(p: String): Int {
        val kinds = listOf(p.any { it.isLowerCase() }, p.any { it.isUpperCase() }, p.any { it.isDigit() },
            p.any { !it.isLetterOrDigit() }).count { it }
        return when {
            p.length >= 16 && kinds >= 3 -> 3
            p.length >= 12 && kinds >= 3 -> 2
            p.length >= 8 && kinds >= 2 -> 1
            else -> 0
        }
    }
}
