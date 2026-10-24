package ru.multibrowser

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.TextUtils
import android.text.format.Formatter
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Экран «Загрузки»: список скачанных файлов с открытием, отправкой и удалением. */
class DownloadsActivity : AppCompatActivity() {

    private lateinit var list: LinearLayout

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(24))
        }
        val root = ScrollView(this).apply {
            setBackgroundColor(Ui.BG)
            isFillViewport = true
            addView(list)
        }
        setContentView(root)
        applyEdgeToEdge(root)
    }

    private fun render() {
        list.removeAllViews()
        list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(iconButton(R.drawable.ic_back, Tr.t("back")) { finish() },
                LinearLayout.LayoutParams(dp(40), dp(40)))
            addView(TextView(context).apply {
                text = Tr.t("downloads")
                textSize = 20f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                setPadding(dp(8), 0, 0, 0)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(iconButton(R.drawable.ic_delete, Tr.t("clear_short")) {
                if (DownloadLog.list(this@DownloadsActivity).isNotEmpty()) {
                    AlertDialog.Builder(this@DownloadsActivity)
                        .setTitle(Tr.t("downloads"))
                        .setMessage(Tr.t("clear_short"))
                        .setPositiveButton(Tr.t("clear")) { _, _ -> DownloadLog.clear(this@DownloadsActivity); render() }
                        .setNegativeButton(Tr.t("cancel"), null)
                        .show()
                }
            }, LinearLayout.LayoutParams(dp(40), dp(40)))
        })

        val items = DownloadLog.list(this)
        if (items.isEmpty()) {
            list.addView(TextView(this).apply {
                text = Tr.t("downloads_empty")
                textSize = 14f
                setTextColor(Ui.MUTED)
                setPadding(0, dp(32), 0, 0)
                gravity = Gravity.CENTER_HORIZONTAL
            })
            return
        }
        val fmt = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault())
        items.forEachIndexed { index, d ->
            list.addView(row(d, index, fmt.format(Date(d.time))))
        }
    }

    private fun row(d: Download, index: Int, when_: String): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(14), dp(10), dp(6), dp(10))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8) }
            setOnClickListener { open(d) }
        }
        row.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(context).apply {
                text = d.name
                textSize = 15f
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.MIDDLE
            })
            addView(TextView(context).apply {
                text = when_
                textSize = 12f
                setTextColor(Ui.MUTED)
                maxLines = 1
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(menuButton(d, index))
        return row
    }

    private fun menuButton(d: Download, index: Int) = TextView(this).apply {
        text = "⋮"
        textSize = 20f
        gravity = Gravity.CENTER
        setTextColor(Ui.MUTED)
        layoutParams = LinearLayout.LayoutParams(dp(40), dp(40))
        setOnClickListener {
            AlertDialog.Builder(this@DownloadsActivity)
                .setItems(arrayOf(Tr.t("open"), Tr.t("share"), Tr.t("delete"))) { _, which ->
                    when (which) {
                        0 -> open(d)
                        1 -> share(d)
                        2 -> { DownloadLog.removeAt(this@DownloadsActivity, index); render() }
                    }
                }
                .show()
        }
    }

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
}
