package ru.multibrowser

import android.util.Base64
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.InputStream
import java.util.zip.ZipInputStream

/**
 * Просмотр документов прямо в Оси, без интернета и чужих сервисов: Word (DOCX), Excel (XLSX),
 * PowerPoint (PPTX), OpenDocument (ODT, ODS, ODP) и CSV превращаются в простую HTML-страницу
 * (текст, заголовки, жирный/курсив, таблицы, листы, слайды, картинки DOCX).
 */
object DocView {
    private val EXT = setOf("docx", "xlsx", "pptx", "odt", "ods", "odp", "csv")
    private const val MAX_ENTRY = 40L * 1024 * 1024
    private const val MAX_ROWS = 3000
    private const val MAX_COLS = 60

    fun supports(name: String) = name.substringAfterLast('.', "").lowercase() in EXT

    /** HTML-страница документа; null — формат не поддержан или файл повреждён. */
    fun toHtml(input: InputStream, name: String): String? = runCatching {
        val ext = name.substringAfterLast('.', "").lowercase()
        val body = when (ext) {
            "csv" -> csv(input.readBytes().toString(Charsets.UTF_8))
            else -> {
                val zip = unzip(input)
                when (ext) {
                    "docx" -> docx(zip)
                    "xlsx" -> xlsx(zip)
                    "pptx" -> pptx(zip)
                    "odt", "ods", "odp" -> odf(zip)
                    else -> return null
                }
            }
        }
        page(name, body)
    }.getOrNull()

    // --- Общее ---

    private fun unzip(input: InputStream): Map<String, ByteArray> {
        val out = HashMap<String, ByteArray>()
        ZipInputStream(input).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (!e.isDirectory && (e.size < 0 || e.size <= MAX_ENTRY)) out[e.name] = z.readBytes()
            }
        }
        return out
    }

    private fun parser(bytes: ByteArray): XmlPullParser = Xml.newPullParser().apply {
        setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        setInput(bytes.inputStream(), "UTF-8")
    }

    fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private fun page(title: String, body: String) = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--bg:#fff;--fg:#1b1b1d;--muted:#666;--line:#ddd;--head:#f3f3f5}
@media (prefers-color-scheme: dark){:root{--bg:#17181B;--fg:#ececee;--muted:#9a9aa2;--line:#33343a;--head:#222328}}
body{background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif;margin:0;padding:16px;overflow-wrap:anywhere}
h1.doc{font-size:15px;color:var(--muted);font-weight:600;margin:0 0 14px}
table{border-collapse:collapse;margin:10px 0;font-size:14px}td,th{border:1px solid var(--line);padding:4px 8px;vertical-align:top}
th{background:var(--head);color:var(--muted);font-weight:600}.wrap{overflow-x:auto}
.slide{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}.slide h3{margin:0 0 8px;color:var(--muted);font-size:13px}
img{max-width:100%;height:auto}li{margin:2px 0}</style></head><body><h1 class="doc">${esc(title)}</h1>
$body</body></html>"""

    // --- Word (DOCX) ---

    private fun docx(zip: Map<String, ByteArray>): String {
        val doc = zip["word/document.xml"] ?: error("no document.xml")
        val rels = relations(zip["word/_rels/document.xml.rels"])
        val sb = StringBuilder()
        val p = parser(doc)
        var para = StringBuilder(); var tag = "p"; var list = false
        var bold = false; var italic = false; var underline = false
        val cells = ArrayDeque<StringBuilder>()
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "w:p" -> { para = StringBuilder(); tag = "p"; list = false }
                    "w:pStyle" -> tag = when (p.getAttributeValue(null, "w:val").orEmpty().lowercase()) {
                        "title", "heading1", "заголовок1" -> "h1"
                        "heading2", "subtitle", "заголовок2" -> "h2"
                        "heading3", "heading4", "заголовок3" -> "h3"
                        else -> tag
                    }
                    "w:numPr" -> list = true
                    "w:r" -> { bold = false; italic = false; underline = false }
                    "w:b" -> bold = p.getAttributeValue(null, "w:val") != "0"
                    "w:i" -> italic = p.getAttributeValue(null, "w:val") != "0"
                    "w:u" -> underline = p.getAttributeValue(null, "w:val") != "none"
                    "w:t" -> {
                        var t = esc(p.nextText())
                        if (underline) t = "<u>$t</u>"
                        if (italic) t = "<i>$t</i>"
                        if (bold) t = "<b>$t</b>"
                        para.append(t)
                    }
                    "w:tab" -> para.append("&emsp;")
                    "w:br" -> para.append("<br>")
                    "a:blip" -> {
                        val id = p.getAttributeValue(null, "r:embed")
                        val target = rels[id]?.let { if (it.startsWith("/")) it.drop(1) else "word/$it" }
                        val bytes = target?.let { zip[it] }
                        if (bytes != null) {
                            val mime = if (target.endsWith(".png", true)) "image/png" else if (target.endsWith(".gif", true)) "image/gif" else "image/jpeg"
                            para.append("<img src=\"data:$mime;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}\">")
                        }
                    }
                    "w:tbl" -> sb.append(if (cells.isEmpty()) "<div class=\"wrap\"><table>" else "<table>")
                    "w:tr" -> target(sb, cells).append("<tr>")
                    "w:tc" -> cells.addLast(StringBuilder())
                }
                XmlPullParser.END_TAG -> when (p.name) {
                    "w:p" -> {
                        val html = if (list) "<li>$para</li>" else if (para.isEmpty()) "" else "<$tag>$para</$tag>"
                        target(sb, cells).append(html)
                    }
                    "w:tc" -> { val c = cells.removeLast(); target(sb, cells).append("<td>").append(c).append("</td>") }
                    "w:tr" -> target(sb, cells).append("</tr>")
                    "w:tbl" -> target(sb, cells).append(if (cells.isEmpty()) "</table></div>" else "</table>")
                }
            }
        }
        return sb.toString().replace(Regex("(</li>)(?!<li>)"), "$1</ul>").replace(Regex("(?<!</li>)(<li>)"), "<ul>$1")
    }

    private fun target(sb: StringBuilder, cells: ArrayDeque<StringBuilder>) = cells.lastOrNull() ?: sb

    private fun relations(bytes: ByteArray?): Map<String, String> {
        bytes ?: return emptyMap()
        val out = HashMap<String, String>()
        val p = parser(bytes)
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            if (p.eventType == XmlPullParser.START_TAG && p.name == "Relationship") {
                out[p.getAttributeValue(null, "Id").orEmpty()] = p.getAttributeValue(null, "Target").orEmpty()
            }
        }
        return out
    }

    // --- Excel (XLSX) ---

    private fun xlsx(zip: Map<String, ByteArray>): String {
        val shared = ArrayList<String>()
        zip["xl/sharedStrings.xml"]?.let { bytes ->
            val p = parser(bytes); var cur: StringBuilder? = null
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when {
                    p.eventType == XmlPullParser.START_TAG && p.name == "si" -> cur = StringBuilder()
                    p.eventType == XmlPullParser.START_TAG && p.name == "t" -> cur?.append(p.nextText())
                    p.eventType == XmlPullParser.END_TAG && p.name == "si" -> { shared += cur.toString(); cur = null }
                }
            }
        }
        val rels = relations(zip["xl/_rels/workbook.xml.rels"])
        val sheets = ArrayList<Pair<String, String>>()
        zip["xl/workbook.xml"]?.let { bytes ->
            val p = parser(bytes)
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                if (p.eventType == XmlPullParser.START_TAG && p.name == "sheet") {
                    val target = rels[p.getAttributeValue(null, "r:id")] ?: continue
                    sheets += p.getAttributeValue(null, "name").orEmpty() to (if (target.startsWith("/")) target.drop(1) else "xl/$target")
                }
            }
        }
        if (sheets.isEmpty()) zip.keys.filter { it.startsWith("xl/worksheets/sheet") }.sorted().forEachIndexed { i, k -> sheets += "${i + 1}" to k }
        val sb = StringBuilder()
        sheets.forEach { (name, path) ->
            val bytes = zip[path] ?: return@forEach
            if (sheets.size > 1) sb.append("<h2>").append(esc(name)).append("</h2>")
            sb.append(sheetTable(bytes, shared))
        }
        return sb.toString()
    }

    private fun column(ref: String): Int {
        var n = 0
        for (ch in ref) { if (ch !in 'A'..'Z') break; n = n * 26 + (ch - 'A' + 1) }
        return n - 1
    }

    private fun columnName(i: Int): String {
        var n = i + 1; val sb = StringBuilder()
        while (n > 0) { val r = (n - 1) % 26; sb.insert(0, 'A' + r); n = (n - 1) / 26 }
        return sb.toString()
    }

    private fun sheetTable(bytes: ByteArray, shared: List<String>): String {
        val rows = ArrayList<Pair<Int, Map<Int, String>>>()
        val p = parser(bytes)
        var row = HashMap<Int, String>(); var rowNum = 0
        var col = 0; var type = ""; var value = StringBuilder(); var inCell = false
        while (p.next() != XmlPullParser.END_DOCUMENT && rows.size < MAX_ROWS) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "row" -> { row = HashMap(); rowNum = p.getAttributeValue(null, "r")?.toIntOrNull() ?: (rowNum + 1) }
                    "c" -> {
                        col = p.getAttributeValue(null, "r")?.let { column(it) } ?: (row.keys.maxOrNull()?.plus(1) ?: 0)
                        type = p.getAttributeValue(null, "t").orEmpty(); value = StringBuilder(); inCell = true
                    }
                    "v", "t" -> if (inCell) value.append(p.nextText())
                }
                XmlPullParser.END_TAG -> when (p.name) {
                    "c" -> {
                        inCell = false
                        val v = value.toString()
                        val text = when (type) {
                            "s" -> v.toIntOrNull()?.let { shared.getOrNull(it) }.orEmpty()
                            "b" -> if (v == "1") "TRUE" else "FALSE"
                            else -> v
                        }
                        if (text.isNotEmpty() && col in 0 until MAX_COLS) row[col] = text
                    }
                    "row" -> if (row.isNotEmpty()) rows += rowNum to row
                }
            }
        }
        if (rows.isEmpty()) return "<p>—</p>"
        val cols = (rows.maxOf { it.second.keys.maxOrNull() ?: 0 } + 1).coerceAtMost(MAX_COLS)
        val sb = StringBuilder("<div class=\"wrap\"><table><tr><th></th>")
        for (c in 0 until cols) sb.append("<th>").append(columnName(c)).append("</th>")
        sb.append("</tr>")
        rows.forEach { (n, cells) ->
            sb.append("<tr><th>").append(n).append("</th>")
            for (c in 0 until cols) sb.append("<td>").append(esc(cells[c].orEmpty())).append("</td>")
            sb.append("</tr>")
        }
        return sb.append("</table></div>").toString()
    }

    // --- PowerPoint (PPTX) ---

    private fun pptx(zip: Map<String, ByteArray>): String {
        val slides = zip.keys.mapNotNull { k -> Regex("^ppt/slides/slide(\\d+)\\.xml$").find(k)?.groupValues?.get(1)?.toInt()?.let { it to k } }
            .sortedBy { it.first }
        val sb = StringBuilder()
        slides.forEach { (n, key) ->
            val p = parser(zip.getValue(key))
            val paras = ArrayList<String>(); var cur = StringBuilder()
            while (p.next() != XmlPullParser.END_DOCUMENT) {
                when {
                    p.eventType == XmlPullParser.START_TAG && p.name == "a:p" -> cur = StringBuilder()
                    p.eventType == XmlPullParser.START_TAG && p.name == "a:t" -> cur.append(esc(p.nextText()))
                    p.eventType == XmlPullParser.END_TAG && p.name == "a:p" -> if (cur.isNotBlank()) paras += cur.toString()
                }
            }
            sb.append("<div class=\"slide\"><h3>").append(n).append("</h3>")
            paras.forEachIndexed { i, t -> sb.append(if (i == 0) "<h2>$t</h2>" else "<p>$t</p>") }
            sb.append("</div>")
        }
        return sb.toString()
    }

    // --- OpenDocument (ODT, ODS, ODP) ---

    private fun odf(zip: Map<String, ByteArray>): String {
        val p = parser(zip["content.xml"] ?: error("no content.xml"))
        val sb = StringBuilder(); var cur: StringBuilder? = null; var tag = "p"
        val cells = ArrayDeque<StringBuilder>()
        while (p.next() != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG -> when (p.name) {
                    "text:h" -> { cur = StringBuilder(); tag = "h2" }
                    "text:p" -> { cur = StringBuilder(); tag = "p" }
                    "text:tab" -> cur?.append("&emsp;")
                    "text:line-break" -> cur?.append("<br>")
                    "draw:page" -> target(sb, cells).append("<div class=\"slide\">")
                    "table:table" -> target(sb, cells).append("<div class=\"wrap\"><table>")
                    "table:table-row" -> target(sb, cells).append("<tr>")
                    "table:table-cell" -> cells.addLast(StringBuilder())
                }
                XmlPullParser.TEXT -> cur?.append(esc(p.text))
                XmlPullParser.END_TAG -> when (p.name) {
                    "text:h", "text:p" -> { cur?.takeIf { it.isNotBlank() }?.let { target(sb, cells).append("<$tag>$it</$tag>") }; cur = null }
                    "table:table-cell" -> { val c = cells.removeLast(); target(sb, cells).append("<td>").append(c).append("</td>") }
                    "table:table-row" -> target(sb, cells).append("</tr>")
                    "table:table" -> target(sb, cells).append("</table></div>")
                    "draw:page" -> target(sb, cells).append("</div>")
                }
            }
        }
        return sb.toString()
    }

    // --- CSV ---

    private fun csv(text: String): String {
        val first = text.lineSequence().firstOrNull().orEmpty()
        val sep = listOf(';', ',', '\t').maxByOrNull { c -> first.count { it == c } } ?: ','
        val rows = ArrayList<List<String>>()
        var row = ArrayList<String>(); val cell = StringBuilder(); var quoted = false; var i = 0
        while (i < text.length && rows.size < MAX_ROWS) {
            val ch = text[i]
            when {
                quoted && ch == '"' && text.getOrNull(i + 1) == '"' -> { cell.append('"'); i++ }
                ch == '"' -> quoted = !quoted
                !quoted && ch == sep -> { row += cell.toString(); cell.clear() }
                !quoted && (ch == '\n' || ch == '\r') -> {
                    if (ch == '\r' && text.getOrNull(i + 1) == '\n') i++
                    row += cell.toString(); cell.clear(); rows += row; row = ArrayList()
                }
                else -> cell.append(ch)
            }
            i++
        }
        if (cell.isNotEmpty() || row.isNotEmpty()) { row += cell.toString(); rows += row }
        if (rows.isEmpty()) return "<p>—</p>"
        val sb = StringBuilder("<div class=\"wrap\"><table>")
        rows.forEachIndexed { r, cells ->
            sb.append("<tr>")
            cells.take(MAX_COLS).forEach { c -> val t = if (r == 0) "th" else "td"; sb.append("<$t>").append(esc(c)).append("</$t>") }
            sb.append("</tr>")
        }
        return sb.append("</table></div>").toString()
    }
}
