package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Главный экран: список профилей. Нажатие — открыть; долгое нажатие и перетаскивание — сменить
 * порядок; долгое нажатие без перетаскивания — меню профиля.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(24))
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
    }

    private fun render() {
        list.removeAllViews()

        list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_wordmark)
                contentDescription = "Ось"
                scaleType = ImageView.ScaleType.FIT_START
            }, LinearLayout.LayoutParams(0, dp(34), 1f))
            addView(iconButton(R.drawable.ic_settings, Tr.t("settings")) {
                startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
            }, LinearLayout.LayoutParams(dp(40), dp(40)))
        })
        list.addView(TextView(this).apply {
            text = Tr.t("profiles")
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(0, dp(20), 0, dp(6))
        })
        list.addView(TextView(this).apply {
            text = Tr.t("profiles_desc", Settings.profileCount(this@MainActivity))
            textSize = 13f
            setTextColor(Ui.MUTED)
            setPadding(0, 0, 0, dp(12))
        })
        list.addView(ExtrasUi.hint(this, Tr.t("profiles_reorder_hint")).apply { setPadding(0, 0, 0, dp(4)) })
        Profiles.all(this).forEach { list.addView(row(it)) }
    }

    // --- Перетаскивание профилей ---
    private var dragRow: View? = null
    private var dragStartY = 0f
    private var dragMoved = false

    /** Долгое нажатие поднимает строку; дальше она едет за пальцем и меняется местами с соседями. */
    private fun startDrag(row: View, y: Float) {
        dragRow = row
        dragStartY = y
        dragMoved = false
        row.parent.requestDisallowInterceptTouchEvent(true)
        row.isPressed = false
        row.elevation = dpf(8)
        row.animate().scaleX(1.03f).scaleY(1.03f).setDuration(120).start()
        row.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
    }

    private fun dragTo(row: View, y: Float) {
        var dy = y - dragStartY
        if (kotlin.math.abs(dy) > dp(6)) dragMoved = true
        val index = list.indexOfChild(row)
        val neighbor = list.getChildAt(index + if (dy > 0) 1 else -1)
        // Меняемся местами, когда строка прошла половину соседней (только среди строк профилей).
        if (neighbor?.getTag(R.id.profile_row) != null && kotlin.math.abs(dy) > neighbor.height / 2f + dp(4)) {
            val shift = (neighbor.height + dp(8)) * if (dy > 0) 1 else -1
            // Двигаем соседа, а не саму строку: снятие строки под пальцем отменило бы жест.
            list.removeView(neighbor)
            list.addView(neighbor, index)
            dragStartY += shift
            dy -= shift
        }
        row.translationY = dy
    }

    private fun endDrag(row: View, p: Profile) {
        dragRow = null
        row.elevation = 0f
        row.animate().translationY(0f).scaleX(1f).scaleY(1f).setDuration(150).start()
        if (dragMoved) {
            val ids = (0 until list.childCount).mapNotNull { list.getChildAt(it).getTag(R.id.profile_row) as? Int }
            Profiles.setOrder(this, ids)
        } else {
            profileMenu(p)
        }
    }

    private fun row(p: Profile): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(62)
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8) }
            setTag(R.id.profile_row, p.id)
            setOnClickListener { openPin(p, Pins.all(this@MainActivity).first()) }
        }
        var lastY = 0f
        row.setOnLongClickListener { startDrag(row, lastY); true }
        row.setOnTouchListener { v, e ->
            lastY = e.rawY
            if (dragRow !== v) return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_MOVE -> dragTo(v, e.rawY)
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> endDrag(v, p)
            }
            true
        }

        // Цветная полоска слева — как акцентная граница у полей knitERP.
        row.addView(View(this).apply { setBackgroundColor(p.color) },
            LinearLayout.LayoutParams(dp(3), LinearLayout.LayoutParams.MATCH_PARENT))

        row.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(8), dp(10))
            addView(TextView(context).apply {
                text = p.name
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            })
            addView(TextView(context).apply {
                text = p.email ?: Tr.t("not_signed_in")
                textSize = 13f
                setTextColor(Ui.MUTED)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            })
            // Описание профиля и число прикреплённых файлов.
            val files = ProfileFiles.count(this@MainActivity, p.id)
            val extra = listOfNotNull(p.description.takeIf { it.isNotBlank() },
                Tr.t("files_n", files).takeIf { files > 0 }).joinToString(" · ")
            if (extra.isNotEmpty()) addView(TextView(context).apply {
                text = extra
                textSize = 12f
                setTextColor(Ui.MUTED)
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        if (Gecko.isActive(this, p.id)) {
            row.addView(View(this).apply { background = Ui.oval(Ui.ACCENT) },
                LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) })
        }
        // По пилюле на каждую закреплённую вкладку. Для Gmail показываем счётчик непрочитанных.
        val pillRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        Pins.all(this).forEachIndexed { i, pin ->
            val isMail = pin.url.contains("mail.google.com")
            val label = if (isMail && p.unread > 0) "${pin.title} · ${if (p.unread > 999) "999+" else p.unread}" else pin.title
            pillRow.addView(pill(label, isMail && p.unread > 0) { openPin(p, pin) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(32)).apply {
                    if (i > 0) marginStart = dp(6)
                })
        }
        row.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(pillRow)
            setPadding(0, 0, dp(12), 0)
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        return row
    }

    private fun openPin(p: Profile, pin: Pin) {
        startActivity(Intent(this, BrowserActivity::class.java)
            .putExtra(BrowserActivity.EXTRA_PROFILE, p.id)
            .putExtra(BrowserActivity.EXTRA_SITE, pin.id))
    }

    /** Кнопка-«пилюля» быстрого входа во вкладку; акцентная — если есть непрочитанные. */
    private fun pill(label: String, highlight: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 12f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(if (highlight) Ui.ON_ACCENT else Ui.TEXT)
        background = if (highlight) Ui.rounded(Ui.ACCENT, dpf(5)) else Ui.rounded(Ui.BG, dpf(5), dp(1))
        setPadding(dp(10), 0, dp(10), 0)
        minHeight = dp(32)
        setOnClickListener { onClick() }
    }

    private fun profileMenu(p: Profile) {
        val order = Profiles.order(this)
        val actions = mutableListOf<Pair<String, () -> Unit>>(
            Tr.t("profile_info") to { openInfo(p) },
            Tr.t("rename") to { renameDialog(p) },
        )
        if (order.firstOrNull() != p.id) actions += Tr.t("move_up") to { Profiles.move(this, p.id, -1); render() }
        if (order.lastOrNull() != p.id) actions += Tr.t("move_down") to { Profiles.move(this, p.id, 1); render() }
        actions += Tr.t("logout_clear") to { clearDialog(p) }
        AlertDialog.Builder(this)
            .setTitle(p.name)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun openInfo(p: Profile) {
        startActivity(Intent(this, ProfileActivity::class.java).putExtra(ProfileActivity.EXTRA_PROFILE, p.id))
    }

    private fun renameDialog(p: Profile) {
        val input = EditText(this).apply {
            setText(p.name)
            setSingleLine()
            setTextColor(Ui.TEXT)
        }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("profile_name"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                if (input.text.isNotBlank()) Profiles.rename(this, p.id, input.text.toString())
                render()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun clearDialog(p: Profile) {
        AlertDialog.Builder(this)
            .setTitle(Tr.t("clear_q", p.name))
            .setMessage(Tr.t("clear_profile_msg"))
            .setPositiveButton(Tr.t("clear")) { _, _ ->
                Gecko.clearProfile(this, p.id)
                render()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }
}
