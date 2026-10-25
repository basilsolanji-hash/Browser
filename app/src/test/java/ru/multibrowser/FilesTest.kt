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

/** Тип скачанного файла: «неизвестный» от сайта заменяется типом по расширению. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class EffectiveMimeTest(private val mime: String, private val name: String, private val expected: String, private val inOs: Boolean) {
    companion object {
        @JvmStatic
        @Parameters(name = "{1} ({0})")
        fun cases(): List<Array<Any>> = listOf(
            arrayOf("application/octet-stream", "Os-Browser-build-123.apk", "application/vnd.android.package-archive", false),
            arrayOf("application/octet-stream", "report.pdf", "application/pdf", true),
            arrayOf("", "photo.jpg", "image/jpeg", true),
            arrayOf("binary/octet-stream", "notes.txt", "text/plain", true),
            arrayOf("application/force-download", "song.mp3", "audio/mpeg", false),
            arrayOf("application/pdf", "file.bin", "application/pdf", true),
            arrayOf("text/csv", "data.csv", "text/csv", true),
            arrayOf("application/octet-stream", "blob.unknownext", "application/octet-stream", false),
            arrayOf("application/zip", "a.zip", "application/zip", false),
            arrayOf("image/png", "x.png", "image/png", true),
        )
    }

    @Test
    fun mimeAndViewer() {
        val m = Downloads.effectiveMime(mime, name)
        assertEquals(expected, m)
        assertEquals(inOs, Downloads.viewableInOs(m))
    }
}

/** Генератор паролей: длина, обязательные виды символов, без похожих, разные результаты. */
class PasswordGenTest {
    @org.junit.Test
    fun rules() {
        repeat(200) {
            val p = PasswordGen.generate(16)
            org.junit.Assert.assertEquals(16, p.length)
            org.junit.Assert.assertTrue(p, p.any { it.isLowerCase() } && p.any { it.isUpperCase() } && p.any { it.isDigit() } && p.any { !it.isLetterOrDigit() })
            org.junit.Assert.assertTrue(p, p.none { it in "0O1lI" })
        }
        val noSym = PasswordGen.generate(12, symbols = false)
        org.junit.Assert.assertTrue(noSym.all { it.isLetterOrDigit() })
        org.junit.Assert.assertEquals(8, PasswordGen.generate(3).length)
        org.junit.Assert.assertEquals(64, PasswordGen.generate(500).length)
        org.junit.Assert.assertEquals(100, (1..100).map { PasswordGen.generate() }.toSet().size)
    }

    @org.junit.Test
    fun strength() {
        org.junit.Assert.assertEquals(0, PasswordGen.strength("12345"))
        org.junit.Assert.assertEquals(1, PasswordGen.strength("abcdefg1"))
        org.junit.Assert.assertEquals(2, PasswordGen.strength("Abcdefghij12"))
        org.junit.Assert.assertEquals(3, PasswordGen.strength(PasswordGen.generate()))
    }
}
