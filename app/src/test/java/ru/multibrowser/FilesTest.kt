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

/** Просмотр документов в Оси: DOCX, XLSX, PPTX, ODT, CSV → HTML без сети. */
@RunWith(org.robolectric.RobolectricTestRunner::class)
class DocViewTest {
    private fun zip(vararg files: Pair<String, String>): java.io.InputStream {
        val out = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(out).use { z ->
            files.forEach { (name, text) -> z.putNextEntry(java.util.zip.ZipEntry(name)); z.write(text.toByteArray()); z.closeEntry() }
        }
        return out.toByteArray().inputStream()
    }

    @Test
    fun supported() {
        listOf("a.docx", "B.XLSX", "c.pptx", "d.odt", "e.ods", "f.odp", "g.csv").forEach { assertTrue(it, DocView.supports(it)) }
        listOf("a.doc", "b.pdf", "c.zip", "noext").forEach { assertFalse(it, DocView.supports(it)) }
    }

    @Test
    fun docx() {
        val doc = """<w:document xmlns:w="w"><w:body>
            <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Отчёт</w:t></w:r></w:p>
            <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Жирный</w:t></w:r><w:r><w:t xml:space="preserve"> и &lt;обычный&gt;</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Пункт</w:t></w:r></w:p>
            <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
            </w:body></w:document>"""
        val html = DocView.toHtml(zip("word/document.xml" to doc), "report.docx")!!
        assertTrue(html, html.contains("<h1>Отчёт</h1>"))
        assertTrue(html, html.contains("<b>Жирный</b> и &lt;обычный&gt;"))
        assertTrue(html, html.contains("<ul><li>Пункт</li></ul>"))
        assertTrue(html, html.contains("<td><p>A1</p></td><td><p>B1</p></td>"))
    }

    @Test
    fun xlsx() {
        val html = DocView.toHtml(zip(
            "xl/workbook.xml" to """<workbook><sheets><sheet name="Бюджет" r:id="rId1"/><sheet name="Итог" r:id="rId2"/></sheets></workbook>""",
            "xl/_rels/workbook.xml.rels" to """<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>""",
            "xl/sharedStrings.xml" to """<sst><si><t>Статья</t></si><si><r><t>Сум</t></r><r><t>ма</t></r></si></sst>""",
            "xl/worksheets/sheet1.xml" to """<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="C2"><v>1500</v></c></row></sheetData></worksheet>""",
            "xl/worksheets/sheet2.xml" to """<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Готово</t></is></c></row></sheetData></worksheet>""",
        ), "budget.xlsx")!!
        assertTrue(html.contains("<h2>Бюджет</h2>") && html.contains("<h2>Итог</h2>"))
        assertTrue(html, html.contains("<th>1</th><td>Статья</td><td></td><td>Сумма</td>"))
        assertTrue(html, html.contains("<td>1500</td>"))
        assertTrue(html.contains("Готово"))
    }

    @Test
    fun pptxAndOdtAndCsv() {
        val ppt = DocView.toHtml(zip(
            "ppt/slides/slide2.xml" to """<p:sld><a:p><a:r><a:t>Второй</a:t></a:r></a:p></p:sld>""",
            "ppt/slides/slide1.xml" to """<p:sld><a:p><a:r><a:t>План</a:t></a:r></a:p><a:p><a:r><a:t>Цели</a:t></a:r></a:p></p:sld>""",
        ), "deck.pptx")!!
        assertTrue(ppt, ppt.indexOf("План") < ppt.indexOf("Второй") && ppt.contains("<h2>План</h2><p>Цели</p>"))
        val odt = DocView.toHtml(zip("content.xml" to """<office:document-content><office:body><office:text><text:h>Глава</text:h><text:p>Текст <text:span>внутри</text:span></text:p></office:text></office:body></office:document-content>"""), "a.odt")!!
        assertTrue(odt, odt.contains("<h2>Глава</h2>") && odt.contains("<p>Текст внутри</p>"))
        val csv = DocView.toHtml("Имя;Сумма\n\"Иванов; И.\";100\n".byteInputStream(), "list.csv")!!
        assertTrue(csv, csv.contains("<th>Имя</th><th>Сумма</th>") && csv.contains("<td>Иванов; И.</td><td>100</td>"))
    }

    @Test
    fun brokenFileIsNull() {
        org.junit.Assert.assertNull(DocView.toHtml("not a zip".byteInputStream(), "x.docx"))
        org.junit.Assert.assertNull(DocView.toHtml(zip("other.xml" to "<a/>"), "x.docx"))
    }
}
