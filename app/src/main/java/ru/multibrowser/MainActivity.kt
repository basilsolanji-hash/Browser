package ru.multibrowser

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
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
    private var expanded = false // показаны все профили, а не первые VISIBLE

    companion object {
        /** Сколько профилей видно сразу; остальные — под «Показать все». */
        const val VISIBLE = 10
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // Фокус на списке, а не на поле поиска: клавиатура не выскакивает при открытии.
            isFocusableInTouchMode = true
            setPadding(dp(16), dp(20), dp(16), dp(24))
        }
        val root = ScrollView(this).apply {
            setBackgroundColor(Ui.BG)
            isFillViewport = true
            addView(list, readableWidth())
        }
        setContentView(root)
        applyEdgeToEdge(root)
        // Первый запуск: профили-примеры и обучение.
        if (savedInstanceState == null && Onboarding.shouldShow(this)) {
            startActivity(Intent(this, OnboardingActivity::class.java))
        }
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
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            // Общий личный кабинет: пароли всех профилей, генератор, резервная копия.
            addView(iconButton(R.drawable.ic_lock, Tr.t("cabinet")) {
                startActivity(Intent(this@MainActivity, AccountActivity::class.java))
            }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(8) })
            addView(iconButton(R.drawable.ic_settings, Tr.t("settings")) {
                startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
            }, LinearLayout.LayoutParams(dp(40), dp(40)))
        })
        // Логотип, «бизнес-браузер» и коротко о приложении — как на стартовой странице и в «О приложении».
        list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_wordmark)
                contentDescription = "Ось"
                scaleType = ImageView.ScaleType.FIT_CENTER
            }, LinearLayout.LayoutParams(dp(180), dp(52)))
            addView(ExtrasUi.paragraph(context, Tr.t("start_tagline"), 12f, Ui.MUTED, bold = true).apply {
                gravity = Gravity.CENTER
                letterSpacing = 0.14f
                setPadding(0, dp(8), 0, 0)
            })
            addView(ExtrasUi.paragraph(context, Tr.t("about_desc"), 13f, Ui.MUTED).apply { gravity = Gravity.CENTER })
            // Приветствие по времени суток и позитивная фраза — каждый раз новая, без повторов.
            addView(ExtrasUi.paragraph(context, Phrases.greeting(), 17f, Ui.TEXT, bold = true).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(12), 0, 0)
            })
            Phrases.next(this@MainActivity)?.let { phrase ->
                addView(ExtrasUi.paragraph(context, phrase, 14f, Ui.MUTED).apply {
                    gravity = Gravity.CENTER
                    setTypeface(typeface, Typeface.ITALIC)
                })
            }
        })
        list.addView(quickSearch())
        // Быстрый доступ к библиотеке и сведениям о приложении.
        list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(6), 0, 0)
            listOf(
                Tr.t("notes") to NotesActivity::class.java,
                Tr.t("saved_pages") to SavedPagesActivity::class.java,
                Tr.t("about") to AboutActivity::class.java,
            ).forEachIndexed { i, (label, screen) ->
                // Поровну на всю ширину: длинные подписи (ru, de) переносятся, а не обрезаются.
                // Одинаковая высота у всех трёх, даже если одна подпись в две строки.
                addView(pill(label, false) { startActivity(Intent(this@MainActivity, screen)) }.apply {
                    maxLines = 2
                    minHeight = dp(44)
                    setPadding(dp(6), dp(4), dp(6), dp(4))
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply {
                    if (i > 0) marginStart = dp(6)
                })
            }
        })
        // Заголовок «Профили» и переключатель вида: список или плитка.
        val grid = Settings.profilesGrid(this)
        list.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(20), 0, dp(6))
            addView(TextView(context).apply {
                text = Tr.t("profiles")
                textSize = 20f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            listOf(false to R.drawable.ic_view_list, true to R.drawable.ic_view_grid).forEach { (g, icon) ->
                addView(iconButton(icon, Tr.t(if (g) "profiles_view_grid" else "profiles_view_list")) {
                    Settings.setProfilesGrid(this@MainActivity, g); render()
                }.apply {
                    background = if (g == grid) Ui.rounded(Ui.SURFACE, dpf(8), dp(1), Ui.ACCENT) else null
                    isSelected = g == grid
                }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(4) })
            }
        })
        list.addView(TextView(this).apply {
            text = Tr.t("profiles_desc", Settings.profileCount(this@MainActivity))
            textSize = 13f
            setTextColor(Ui.MUTED)
            setPadding(0, 0, 0, dp(12))
        })
        list.addView(ExtrasUi.hint(this, Tr.t(if (grid) "profiles_grid_hint" else "profiles_reorder_hint")).apply { setPadding(0, 0, 0, dp(4)) })
        val all = Profiles.all(this)
        val current = Profiles.lastProfile(this)
        val folders = Profiles.folders(this)
        if (folders.isEmpty()) {
            val shown = all.take(if (expanded) all.size else VISIBLE)
            if (grid) addGrid(shown, current) else shown.forEach { list.addView(row(it, it.id == current)) }
            if (all.size > VISIBLE) {
                list.addView(ExtrasUi.button(this, if (expanded) Tr.t("profiles_fewer") else Tr.t("profiles_all", all.size)) {
                    expanded = !expanded
                    render()
                })
            }
        } else {
            // Папки по алфавиту, затем профили без папки; папку можно свернуть.
            (folders + "").forEach { folder ->
                val inFolder = all.filter { Profiles.folder(this, it.id) == folder }
                if (inFolder.isEmpty()) return@forEach
                val collapsed = folder.isNotEmpty() && Profiles.folderCollapsed(this, folder)
                list.addView(folderHeader(folder, inFolder.size, collapsed))
                if (!collapsed) {
                    if (grid) addGrid(inFolder, current) else inFolder.forEach { list.addView(row(it, it.id == current)) }
                }
            }
        }
    }

    /** Заголовок папки: значок, название, число профилей, стрелка; нажатие — свернуть, долгое — меню. */
    private fun folderHeader(folder: String, count: Int, collapsed: Boolean) = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(4), dp(16), dp(4), dp(4))
        contentDescription = folder.ifEmpty { Tr.t("folder_none") }
        addView(icon(R.drawable.ic_folder, if (folder.isEmpty()) Ui.MUTED else Ui.ACCENT, 20))
        addView(TextView(context).apply {
            text = "${folder.ifEmpty { Tr.t("folder_none") }} · $count"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(dp(10), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        if (folder.isNotEmpty()) {
            addView(icon(if (collapsed) R.drawable.ic_down else R.drawable.ic_up, Ui.MUTED, 20))
            setOnClickListener { Profiles.setFolderCollapsed(this@MainActivity, folder, !collapsed); render() }
            setOnLongClickListener { folderMenu(folder); true }
        }
    }

    private fun folderMenu(folder: String) {
        val actions = listOf<Pair<String, () -> Unit>>(
            Tr.t("folder_rename") to {
                textDialog(Tr.t("folder_name"), folder) { name -> Profiles.renameFolder(this, folder, name); render() }
            },
            Tr.t("folder_delete") to { Profiles.deleteFolder(this, folder); render() },
        )
        AlertDialog.Builder(this)
            .setTitle(folder)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    /** Профиль — в папку: существующую, новую или «без папки». */
    private fun folderPicker(p: Profile) {
        val folders = Profiles.folders(this)
        val labels = folders + Tr.t("folder_new") + Tr.t("folder_none")
        AlertDialog.Builder(this)
            .setTitle(Tr.t("folder_move"))
            .setItems(labels.toTypedArray()) { _, i ->
                when {
                    i < folders.size -> { Profiles.setFolder(this, p.id, folders[i]); render() }
                    i == folders.size -> textDialog(Tr.t("folder_name"), "") { name -> Profiles.setFolder(this, p.id, name); render() }
                    else -> { Profiles.setFolder(this, p.id, ""); render() }
                }
            }
            .show()
    }

    private fun textDialog(title: String, value: String, onSave: (String) -> Unit) {
        val input = EditText(this).apply { setText(value); setSingleLine(); setTextColor(Ui.TEXT) }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ -> if (input.text.isNotBlank()) onSave(input.text.toString()) }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    /** Плитка: 2 колонки на телефоне, 4 — на широком экране. */
    private fun addGrid(profiles: List<Profile>, current: Int) {
        val cols = if (resources.configuration.screenWidthDp >= 600) 4 else 2
        profiles.chunked(cols).forEach { chunk ->
            list.addView(LinearLayout(this).apply {
                chunk.forEachIndexed { i, p ->
                    addView(tile(p, p.id == current), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                        if (i > 0) marginStart = dp(8)
                        topMargin = dp(8)
                    })
                }
                repeat(cols - chunk.size) { addView(View(context), LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = dp(8) }) }
            })
        }
    }

    private fun tile(p: Profile, current: Boolean) = FrameLayout(this).apply {
        background = if (current) Ui.rounded(Ui.SURFACE, dpf(12), dp(2), Ui.ACCENT) else Ui.rounded(Ui.SURFACE, dpf(12), dp(1))
        contentDescription = p.name
        setOnClickListener { openPin(p, Pins.all(this@MainActivity, p.id).first()) }
        setOnLongClickListener { profileMenu(p); true }
        addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(10), dp(16), dp(10), dp(14))
            addView(TextView(context).apply {
                text = p.name.take(1).uppercase()
                textSize = 20f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(android.graphics.Color.WHITE)
                background = Ui.oval(p.color)
            }, LinearLayout.LayoutParams(dp(52), dp(52)))
            addView(TextView(context).apply {
                text = p.name
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Ui.TEXT)
                gravity = Gravity.CENTER
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(10), 0, 0)
            })
            addView(TextView(context).apply {
                text = p.email ?: p.description.ifBlank { Tr.t("not_signed_in") }
                textSize = 12f
                setTextColor(Ui.MUTED)
                gravity = Gravity.CENTER
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(2), 0, 0)
            })
        })
        // Значки по углам: закреплён — слева, текущий — справа, шестерёнка — снизу справа.
        if (Profiles.isPinned(this@MainActivity, p.id)) addView(icon(R.drawable.ic_pin, Ui.ACCENT, 16),
            FrameLayout.LayoutParams(dp(16), dp(16), Gravity.TOP or Gravity.START).apply { setMargins(dp(10), dp(10), 0, 0) })
        if (current) addView(icon(R.drawable.ic_check, Ui.ACCENT, 18).apply { contentDescription = Tr.t("profile_current") },
            FrameLayout.LayoutParams(dp(18), dp(18), Gravity.TOP or Gravity.END).apply { setMargins(0, dp(10), dp(10), 0) })
        addView(iconButton(R.drawable.ic_settings, Tr.t("profile_settings")) { openInfo(p) }.apply { background = null },
            FrameLayout.LayoutParams(dp(36), dp(36), Gravity.BOTTOM or Gravity.END))
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
            // Переставляли только видимые; скрытые профили остаются за ними в прежнем порядке.
            val ids = (0 until list.childCount).mapNotNull { list.getChildAt(it).getTag(R.id.profile_row) as? Int }
            Profiles.setOrder(this, ids + Profiles.order(this).filterNot { it in ids })
        } else {
            profileMenu(p)
        }
    }

    /** Быстрый поиск: запрос или адрес открывается новой вкладкой в последнем (или выбранном) профиле. */
    private fun quickSearch(): View {
        var target = Profiles.lastProfile(this)
        val where = TextView(this).apply {
            textSize = 12f
            setTextColor(Ui.MUTED)
            setPadding(dp(4), dp(6), dp(4), 0)
        }
        fun showTarget() { where.text = Tr.t("qs_in_profile", Profiles.get(this, target).name) }
        showTarget()
        where.setOnClickListener {
            val all = Profiles.all(this)
            AlertDialog.Builder(this)
                .setTitle(Tr.t("qs_pick_profile"))
                .setItems(all.map { it.name }.toTypedArray()) { _, i -> target = all[i].id; showTarget() }
                .show()
        }
        val field = EditText(this).apply {
            hint = Tr.t("address_hint")
            contentDescription = Tr.t("address_hint")
            setSingleLine()
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            imeOptions = EditorInfo.IME_ACTION_GO
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            background = null
            setPadding(dp(10), 0, dp(10), 0)
        }
        fun go() {
            val text = field.text.toString()
            if (text.isBlank()) return
            field.setText("")
            startActivity(Intent(this, BrowserActivity::class.java)
                .putExtra(BrowserActivity.EXTRA_PROFILE, target)
                .putExtra(BrowserActivity.EXTRA_ACTION, BrowserActivity.ACTION_NEW_TAB)
                .putExtra(BrowserActivity.EXTRA_URL, Search.toUrl(this, text)))
        }
        field.setOnEditorActionListener { _, action, event ->
            val enter = event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
            if (action == EditorInfo.IME_ACTION_GO || enter) { go(); true } else false
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(10), 0, dp(4))
            addView(LinearLayout(context).apply {
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
                setPadding(dp(12), 0, dp(4), 0)
                addView(icon(R.drawable.ic_search, Ui.MUTED, 20))
                addView(field, LinearLayout.LayoutParams(0, dp(48), 1f))
                addView(iconButton(R.drawable.ic_forward, Tr.t("qs_go")) { go() }, LinearLayout.LayoutParams(dp(40), dp(40)))
            })
            addView(where)
        }
    }

    /** [current] — профиль, которым пользовались последним: выделен рамкой и отметкой. */
    private fun row(p: Profile, current: Boolean): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(62)
            background = if (current) Ui.rounded(Ui.SURFACE, dpf(6), dp(2), Ui.ACCENT) else Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(8) }
            setTag(R.id.profile_row, p.id)
            setOnClickListener { openPin(p, Pins.all(this@MainActivity, p.id).first()) }
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
            addView(LinearLayout(context).apply {
                gravity = Gravity.CENTER_VERTICAL
                if (Profiles.isPinned(this@MainActivity, p.id)) addView(icon(R.drawable.ic_pin, Ui.ACCENT, 14).apply {
                    contentDescription = Tr.t("profile_pinned")
                    (layoutParams as LinearLayout.LayoutParams).marginEnd = dp(4)
                })
                addView(TextView(context).apply {
                    text = p.name
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Ui.TEXT)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                if (current) addView(icon(R.drawable.ic_check, Ui.ACCENT, 16).apply { contentDescription = Tr.t("profile_current") })
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
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f))

        if (Gecko.isActive(this, p.id)) {
            row.addView(View(this).apply { background = Ui.oval(Ui.ACCENT) },
                LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) })
        }
        // По пилюле на каждую закреплённую вкладку. Для Gmail показываем счётчик непрочитанных.
        val pillRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        Pins.all(this, p.id).forEachIndexed { i, pin ->
            val isMail = pin.url.contains("mail.google.com")
            val label = if (isMail && p.unread > 0) "${pin.title} · ${if (p.unread > 999) "999+" else p.unread}" else pin.title
            pillRow.addView(pill(label, isMail && p.unread > 0) { openPin(p, pin) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(32)).apply {
                    if (i > 0) marginStart = dp(6)
                })
        }
        // Ширина ограничена, чтобы имя профиля не сжималось; лишние вкладки прокручиваются.
        row.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(pillRow)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        // Настройки профиля: имя, описание, вкладки, файлы, закрепление.
        row.addView(iconButton(R.drawable.ic_settings, Tr.t("profile_settings")) { openInfo(p) }.apply { background = null },
            LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(2); marginEnd = dp(4) })
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
            Tr.t("cabinet") to {
                startActivity(Intent(this, AccountActivity::class.java).putExtra(AccountActivity.EXTRA_PROFILE, p.id))
            },
            Tr.t("profile_settings") to { openInfo(p) },
            Tr.t("rename") to { renameDialog(p) },
            Tr.t("folder_move") to { folderPicker(p) },
            (if (Profiles.isPinned(this, p.id)) Tr.t("profile_unpin") else Tr.t("profile_pin")) to {
                Profiles.setPinned(this, p.id, !Profiles.isPinned(this, p.id)); render()
            },
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
