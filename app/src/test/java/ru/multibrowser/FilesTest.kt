package ru.multibrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.geckoview.WebResponse
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters

/** Имя скачиваемого файла: из Content-Disposition (в т.ч. RFC 5987) или из адреса, без опасных символов. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class DownloadFileNameTest(private val url: String, private val disposition: String?, private val expected: String) {

    companion object {
        @JvmStatic
        @Parameters(name = "{0} | {1}")
        fun cases(): List<Array<Any?>> = listOf(
            arrayOf("https://a.com/files/report.pdf", null, "report.pdf"),
            arrayOf("https://a.com/files/report.pdf?x=1", null, "report.pdf"),
            arrayOf("https://a.com/dl", "attachment; filename=\"invoice.pdf\"", "invoice.pdf"),
            arrayOf("https://a.com/dl", "attachment; filename=invoice.pdf", "invoice.pdf"),
            arrayOf("https://a.com/dl", "attachment; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82.docx", "отчёт.docx"),
            arrayOf("https://a.com/dl", "attachment; filename=\"a.txt\"; filename*=UTF-8''b.txt", "b.txt"),
            arrayOf("https://a.com/dl", "attachment; filename=\"../../etc/passwd\"", ".._.._etc_passwd"),
            arrayOf("https://a.com/dl", "attachment; filename=\"a:b*c?.txt\"", "a_b_c_.txt"),
            arrayOf("https://a.com/dl", "attachment; filename=\"  spaced.zip  \"", "spaced.zip"),
            arrayOf("https://a.com/", null, "download"),
            arrayOf("https://a.com/dl", "inline", "dl"),
            arrayOf("https://a.com/a%20b.txt", null, "a b.txt"),
        )
    }

    @Test
    fun fileName() {
        val b = WebResponse.Builder(url).statusCode(200)
        if (disposition != null) b.addHeader("Content-Disposition", disposition)
        assertEquals(expected, Downloads.fileName(b.build()))
    }
}

/** Имена прикреплённых и отправляемых файлов: без разделителей пути и служебных символов. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class SafeNameTest(private val input: String, private val expected: String) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf(
            "photo.jpg" to "photo.jpg",
            "../../secret" to ".._.._secret",
            "a/b\\c" to "a_b_c",
            "what?.txt" to "what_.txt",
            "  pad.txt " to "pad.txt",
            "tab\tname" to "tab_name",
            "отчёт 2026.xlsx" to "отчёт 2026.xlsx",
            "a\"b<c>d|e" to "a_b_c_d_e",
        ).map { arrayOf<Any>(it.first, it.second) }
    }

    @Test
    fun uploads() = assertEquals(expected, Uploads.safeName(input))

    @Test
    fun profileFiles() = assertEquals(expected, ProfileFiles.safeName(input))
}

class SafeNameLimitsTest {
    @Test
    fun longNamesCut() = assertEquals(120, Uploads.safeName("x".repeat(500)).length)

    @Test
    fun blankBecomesFile() = assertEquals("file", Uploads.safeName("   "))

    @Test
    fun noSeparatorsLeft() {
        val n = Uploads.safeName("a/b/c/../d")
        assertFalse(n.contains('/'))
        assertTrue(n.isNotEmpty())
    }
}
