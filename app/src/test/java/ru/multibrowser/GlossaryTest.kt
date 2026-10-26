package ru.multibrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Словарь терминов docs/GLOSSARY.md совпадает со строками интерфейса: у каждого понятия термин
 * стоит в значении его канонического ключа на всех языках, и запрещённых синонимов в строках нет.
 */
class GlossaryTest {
    private val md = File("../docs/GLOSSARY.md").readLines(Charsets.UTF_8)

    /** Строки таблицы Markdown после заголовка, начинающегося с [head]: ячейки без крайних «|». */
    private fun table(head: String): List<List<String>> {
        val start = md.indexOfFirst { it.startsWith(head) }
        assertTrue("нет таблицы «$head» в GLOSSARY.md", start >= 0)
        return md.drop(start + 2).takeWhile { it.startsWith("|") }
            .map { row -> row.trim().removePrefix("|").removeSuffix("|").split("|").map { it.trim() } }
    }

    @Test
    fun languagesMatchTr() {
        val header = md.first { it.startsWith("| Понятие |") }.split("|").map { it.trim() }.filter { it.isNotEmpty() }
        assertEquals("столбцы языков словаря — как Tr.SUPPORTED", Tr.SUPPORTED, header.drop(2))
    }

    @Test
    fun termsMatchCanonicalKeys() {
        val rows = table("| Понятие |")
        assertTrue("в словаре слишком мало понятий", rows.size >= 20)
        rows.forEach { cells ->
            val key = cells[1].trim('`')
            val row = Tr.M[key] ?: error("${cells[0]}: нет ключа $key")
            val terms = cells.drop(2)
            assertEquals("${cells[0]}: нужно ${Tr.SUPPORTED.size} языков", Tr.SUPPORTED.size, terms.size)
            terms.forEachIndexed { i, term ->
                val value = row[i].lowercase()
                term.lowercase().split(" ").filter { it.isNotEmpty() }.forEach { word ->
                    assertTrue("${cells[0]} [${Tr.SUPPORTED[i]}]: «$term» нет в $key = «${row[i]}»", word in value)
                }
            }
        }
    }

    @Test
    fun noForbiddenSynonyms() {
        val rows = table("| Язык |")
        assertTrue(rows.isNotEmpty())
        rows.forEach { (lang, bad, good) ->
            val i = Tr.SUPPORTED.indexOf(lang)
            assertTrue("неизвестный язык $lang", i >= 0)
            val hits = Tr.M.filterValues { bad in it[i].lowercase() }.keys
            assertTrue("[$lang] «$bad» вместо «$good»: $hits", hits.isEmpty())
        }
    }
}
