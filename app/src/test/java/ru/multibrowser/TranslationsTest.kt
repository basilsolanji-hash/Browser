package ru.multibrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.File

/**
 * Каждая строка интерфейса: все 10 языков есть, не пустые, и подстановки (%s, %d, %1$s…)
 * совпадают с английской — иначе String.format упадёт или покажет не то. По случаю на ключ.
 */
@RunWith(Parameterized::class)
class TranslationsTest(private val key: String) {

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun keys(): List<Array<Any>> = Tr.M.keys.sorted().map { arrayOf<Any>(it) }

        private val SPEC = Regex("""%(\d+\$)?[sd]""")

        /** Подстановки строки без учёта порядка: %1$s и %s считаются одним типом по номеру. */
        fun specs(s: String): List<String> {
            val found = SPEC.findAll(s.replace("%%", "")).map { it.value }.toList()
            return found.mapIndexed { i, v ->
                val type = v.last()
                val pos = Regex("""%(\d+)\$""").find(v)?.groupValues?.get(1)?.toInt() ?: (i + 1)
                "$pos$type"
            }.sorted()
        }
    }

    @Test
    fun allLanguagesPresentAndFilled() {
        val row = Tr.M.getValue(key)
        assertEquals("$key: нужно 10 языков", 10, row.size)
        row.forEachIndexed { i, s -> assertTrue("$key[$i] пустая", s.isNotBlank()) }
    }

    @Test
    fun formatArgumentsMatchEnglish() {
        val row = Tr.M.getValue(key)
        val en = specs(row[0])
        row.forEachIndexed { i, s -> assertEquals("$key[$i]: подстановки «$s»", en, specs(s)) }
    }

    @Test
    fun formattingDoesNotThrow() {
        val row = Tr.M.getValue(key)
        val args = specs(row[0]).sortedBy { it.dropLast(1).toInt() }.map<String, Any> { if (it.last() == 'd') 3 else "x" }.toTypedArray()
        if (args.isEmpty()) return
        row.forEach { String.format(it, *args) }
    }
}

/** Все ключи, которые код запрашивает через Tr.t("…"), есть в переводах. */
class TranslationKeysUsedTest {
    @Test
    fun everyLiteralKeyExists() {
        val src = File("src/main/java/ru/multibrowser")
        val used = src.walk().filter { it.extension == "kt" }.flatMap { f ->
            Regex("""Tr\.t\("([a-z0-9_]+)"""").findAll(f.readText()).map { it.groupValues[1] to f.name }
        }.toList()
        assertTrue("ключи не найдены в исходниках", used.size > 100)
        // Ключ, оканчивающийся на «_», составной («phrase_» + номер) — проверяется ниже по фразам.
        val missing = used.filter { (k, _) -> !k.endsWith("_") && k !in Tr.M }.distinct()
        assertTrue("нет перевода: $missing", missing.isEmpty())
    }

    @Test
    fun allDailyPhrasesExist() = (1..30).forEach { assertTrue("phrase_$it", "phrase_$it" in Tr.M) }

    @Test
    fun localizedExamplesResolve() {
        listOf("ex_personal", "ex_work", "ex_shopping", "ex_social").forEach {
            assertTrue(it, "${it}_name" in Tr.M && "${it}_desc" in Tr.M)
        }
        assertEquals(Tr.t("tab_mail"), Tr.local("@tab_mail"))
        assertEquals("plain", Tr.local("plain"))
    }
}
