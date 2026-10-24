package ru.multibrowser

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.StatFs
import android.text.Editable
import android.text.TextUtils
import android.text.TextWatcher
import android.text.format.DateUtils
import android.text.format.Formatter
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * «Скачанные файлы» — как в системном браузере: память устройства, фильтры по типу, группы по дате,
 * идущие загрузки с круговым прогрессом и «осталось N сек.», поиск по имени.
 */
class DownloadsActivity : AppCompatActivity() {

    private enum class Kind(val key: String, val icon: Int) {
        ALL("dl_all", R.drawable.ic_file), IMAGES("dl_images", R.drawable.ic_image), AUDIO("dl_audio", R.drawable.ic_audio),
        VIDEO("dl_video", R.drawable.ic_video), DOCS("dl_docs", R.drawable.ic_note), OTHER("dl_other", R.drawable.ic_file),
    }

    private lateinit var list: LinearLayout
    private lateinit var search: EditText
    private var filter = Kind.ALL
    private var query = ""
    private var searching = false
    private var shownActive = 0

    // Пока идут загрузки — обновляем прогресс; закончилась — перерисовываем список.
    private val ticker = object : Runnable {
        override fun run() {
            if (Downloads.active.isNotEmpty() || shownActive > 0) render()
            list.postDelayed(this, 700)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(24))
        }
        search = EditText(this).apply {
            hint = Tr.t("dl_search_hint")
            setSingleLine()
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(14), 0, dp(14), 0)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) { query = s?.toString().orEmpty().trim(); render() }
            })
        }
        val root = ScrollView(this).apply {
            setBackgroundColor(Ui.BG)
            isFillViewport = true
            addView(list)
        }
        setContentView(root)
        applyEdgeToEdge(root)
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
        list.postDelayed(ticker, 700)
    }

    override fun onPause() {
        super.onPause()
        list.removeCallbacks(ticker)
    }

    private fun render() {
        list.removeAllViews()
        list.addView(header())
        if (searching) {
            (search.parent as? LinearLayout)?.removeView(search)
            list.addView(search, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(46)).apply { topMargin = dp(8) })
        }
        storageLine()?.let { list.addView(it) }
        list.addView(divider())
        list.addView(chips())

        val running = Downloads.active.toList().filter { matches(it.name, guessMime(it.name)) }
        shownActive = running.size
        val done = DownloadLog.list(this).filter { matches(it.name, it.mime) }
        if (running.isEmpty() && done.isEmpty()) {
            list.addView(TextView(this).apply {
                text = Tr.t(if (query.isEmpty() && filter == Kind.ALL) "downloads_empty" else "nothing_found")
                textSize = 14f
                setTextColor(Ui.MUTED)
                setPadding(0, dp(40), 0, 0)
                gravity = Gravity.CENTER_HORIZONTAL
            })
            return
        }
        // «Только что»: идущие и скачанные за последние 5 минут; дальше — по дням.
        val now = System.currentTimeMillis()
        val recent = done.filter { now - it.time < 5 * 60_000 }
        if (running.isNotEmpty() || recent.isNotEmpty()) {
            list.addView(groupTitle(Tr.t("dl_just_now")))
            running.forEach { list.addView(activeRow(it)) }
            recent.forEach { list.addView(row(it)) }
        }
        done.filterNot { it in recent }.groupBy { dayStart(it.time) }.toSortedMap(compareByDescending { it }).forEach { (day, items) ->
            list.addView(groupTitle(dayTitle(day)))
            items.forEach { list.addView(row(it)) }
        }
    }

    private fun header() = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        addView(iconButton(R.drawable.ic_back, Tr.t("back")) { finish() }, LinearLayout.LayoutParams(dp(40), dp(40)))
        addView(TextView(context).apply {
            text = Tr.t("dl_title")
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(dp(10), 0, 0, 0)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(iconButton(R.drawable.ic_search, Tr.t("dl_search_hint")) {
            searching = !searching
            if (!searching) { search.setText(""); query = "" }
            render()
            if (searching) search.requestFocus()
        }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(6) })
        addView(iconButton(R.drawable.ic_delete, Tr.t("clear_short")) {
            if (DownloadLog.list(this@DownloadsActivity).isEmpty()) return@iconButton
            AlertDialog.Builder(this@DownloadsActivity)
                .setTitle(Tr.t("dl_title"))
                .setMessage(Tr.t("dl_clear_q"))
                .setPositiveButton(Tr.t("clear")) { _, _ -> DownloadLog.clear(this@DownloadsActivity); render() }
                .setNegativeButton(Tr.t("cancel"), null)
                .show()
        }, LinearLayout.LayoutParams(dp(40), dp(40)))
    }

    /** «Использовано: 5,56 ГБ из 490,26 ГБ» — общая память, куда ложатся загрузки. */
    private fun storageLine(): View? = runCatching {
        val st = StatFs(Environment.getExternalStorageDirectory().path)
        val total = st.totalBytes
        val used = total - st.availableBytes
        TextView(this).apply {
            text = Tr.t("dl_storage", Formatter.formatFileSize(context, used), Formatter.formatFileSize(context, total))
            textSize = 13f
            setTextColor(Ui.MUTED)
            setPadding(0, dp(14), 0, dp(12))
        }
    }.getOrNull()

    private fun divider() = View(this).apply {
        setBackgroundColor(Ui.BORDER)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1))
    }

    private fun chips() = HorizontalScrollView(this).apply {
        isHorizontalScrollBarEnabled = false
        setPadding(0, dp(12), 0, dp(4))
        addView(LinearLayout(context).apply {
            Kind.values().forEach { k ->
                val selected = k == filter
                addView(LinearLayout(context).apply {
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(12), 0, dp(14), 0)
                    background = if (selected) Ui.rounded(Ui.SURFACE, dpf(8), dp(1), Ui.ACCENT) else Ui.rounded(Ui.BG, dpf(8), dp(1))
                    contentDescription = Tr.t(k.key)
                    setOnClickListener { filter = k; render() }
                    addView(icon(if (selected) R.drawable.ic_check else k.icon, if (selected) Ui.ACCENT else Ui.MUTED, 18))
                    addView(TextView(context).apply {
                        text = Tr.t(k.key)
                        textSize = 14f
                        setTextColor(Ui.TEXT)
                        setPadding(dp(6), 0, 0, 0)
                    })
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)).apply { marginEnd = dp(8) })
            }
        })
    }

    private fun groupTitle(text: String) = TextView(this).apply {
        this.text = text
        textSize = 15f
        setTextColor(Ui.TEXT)
        setPadding(0, dp(20), 0, dp(6))
    }

    /** Идущая загрузка: круговой прогресс, имя, «Осталось 15 сек. • 123 МБ из 198 МБ», отмена. */
    private fun activeRow(t: Downloads.Task): View = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(64)
        addView(FrameLayout(context).apply {
            addView(ProgressRing(context, if (t.total > 0) t.percent / 100f else -1f), FrameLayout.LayoutParams(dp(44), dp(44)))
            addView(icon(R.drawable.ic_download, Ui.ACCENT, 18), FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER))
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, dp(8), 0)
            addView(title(t.name))
            val sizes = if (t.total > 0) Tr.t("dl_of", Formatter.formatShortFileSize(context, t.done), Formatter.formatShortFileSize(context, t.total))
                else Formatter.formatShortFileSize(context, t.done)
            val left = t.secondsLeft.takeIf { it >= 0 }?.let { Tr.t("dl_left", eta(it)) }
            addView(subtitle(listOfNotNull(left, sizes).joinToString(" • ")))
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(iconButton(R.drawable.ic_close, Tr.t("cancel")) { Downloads.cancel(t.id) }, LinearLayout.LayoutParams(dp(40), dp(40)))
    }

    private fun row(d: Download): View = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(64)
        setOnClickListener { open(d) }
        addView(FrameLayout(context).apply {
            background = Ui.oval(Ui.SURFACE)
            addView(icon(kindOf(d.mime, d.name).icon, Ui.TEXT, 22), FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
        }, LinearLayout.LayoutParams(dp(44), dp(44)))
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, dp(8), 0)
            addView(title(d.name))
            val size = d.size.takeIf { it > 0 }?.let { Formatter.formatShortFileSize(context, it) }
            val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(d.time))
            addView(subtitle(listOfNotNull(size, time).joinToString(" • ")))
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(TextView(context).apply {
            text = "⋮"
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Ui.MUTED)
            contentDescription = Tr.t("menu")
            setOnClickListener { fileMenu(d) }
        }, LinearLayout.LayoutParams(dp(40), dp(40)))
    }

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        textSize = 16f
        setTextColor(Ui.TEXT)
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.MIDDLE
    }

    private fun subtitle(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(Ui.MUTED)
        maxLines = 1
    }

    private fun fileMenu(d: Download) {
        AlertDialog.Builder(this)
            .setTitle(d.name)
            .setItems(arrayOf(Tr.t("open"), Tr.t("share"), Tr.t("delete"))) { _, which ->
                when (which) {
                    0 -> open(d)
                    1 -> share(d)
                    2 -> { DownloadLog.remove(this, d); render() }
                }
            }
            .show()
    }

    // --- Классификация и даты ---

    private fun guessMime(name: String) =
        android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()).orEmpty()

    private fun kindOf(mime: String, name: String): Kind {
        val m = mime.ifEmpty { guessMime(name) }
        return when {
            m.startsWith("image/") -> Kind.IMAGES
            m.startsWith("audio/") -> Kind.AUDIO
            m.startsWith("video/") -> Kind.VIDEO
            m.startsWith("text/") || m == "application/pdf" || "document" in m || "msword" in m ||
                "spreadsheet" in m || "presentation" in m || m == "application/json" -> Kind.DOCS
            else -> Kind.OTHER
        }
    }

    private fun matches(name: String, mime: String) =
        (filter == Kind.ALL || kindOf(mime, name) == filter) && (query.isEmpty() || name.contains(query, ignoreCase = true))

    private fun dayStart(t: Long) = Calendar.getInstance().apply {
        timeInMillis = t; set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    /** «Сегодня — 24 окт. 2026 г.», «Вчера — …» или просто дата. */
    private fun dayTitle(day: Long): String {
        val date = SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(Date(day))
        return when {
            DateUtils.isToday(day) -> Tr.t("dl_today", date)
            DateUtils.isToday(day + DateUtils.DAY_IN_MILLIS) -> Tr.t("dl_yesterday", date)
            else -> date
        }
    }

    private fun eta(sec: Long) = if (sec < 60) Tr.t("dl_sec", sec.toInt()) else Tr.t("dl_min", ((sec + 59) / 60).toInt())

    /** file:// заворачиваем в FileProvider, content:// (MediaStore) открываем напрямую. */
    private fun shareableUri(d: Download): Uri {
        val uri = Uri.parse(d.uri)
        return if (uri.scheme == "file") {
            FileProvider.getUriForFile(this, "$packageName.files", File(uri.path!!))
        } else uri
    }

    private fun open(d: Download) {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(shareableUri(d), d.mime.ifEmpty { "*/*" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, Tr.t("cant_open_file"), Toast.LENGTH_SHORT).show()
        }
    }

    private fun share(d: Download) {
        try {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = d.mime.ifEmpty { "*/*" }
                putExtra(Intent.EXTRA_STREAM, shareableUri(d))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, Tr.t("share")))
        } catch (e: Exception) {
            Toast.makeText(this, Tr.t("cant_open_file"), Toast.LENGTH_SHORT).show()
        }
    }

    /** Круговой прогресс; [fraction] < 0 — размер неизвестен, рисуем дугу без процента. */
    private class ProgressRing(ctx: Context, private val fraction: Float) : View(ctx) {
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Ui.BORDER }
        private val arc = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Ui.ACCENT; strokeCap = Paint.Cap.ROUND }
        private val box = RectF()

        override fun onDraw(canvas: Canvas) {
            val w = resources.displayMetrics.density * 3
            track.strokeWidth = w; arc.strokeWidth = w
            box.set(w, w, width - w, height - w)
            canvas.drawOval(box, track)
            canvas.drawArc(box, -90f, if (fraction < 0) 90f else 360f * fraction.coerceIn(0f, 1f), false, arc)
        }
    }
}
