package ru.multibrowser

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupMenu
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/**
 * Сетка открытых вкладок профиля: квадраты с заголовком и доменом, группы с цветом,
 * поиск по заголовку/адресу и режим выбора нескольких вкладок.
 */
class TabsActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PROFILE = "profile"
        const val EXTRA_CURRENT = "current"
        const val EXTRA_MODE = "mode"
        const val EXTRA_ADD = "add"
        const val EXTRA_FILTER = "filter"
        const val MODE_SELECT = "select"
        const val MODE_NEW_GROUP = "new_group"

        // Только для приёмочных тестов (debug): подготовить группу и выбор без касаний экрана.
        const val EXTRA_DEMO_GROUP = "demo_group"
        const val EXTRA_SELECT_ALL = "select_all"
    }

    private var profile = 1
    private var current: String? = null
    private var selecting = false
    private val selected = LinkedHashSet<String>()
    private var query = ""

    private lateinit var title: TextView
    private lateinit var subtitle: TextView
    private lateinit var search: EditText
    private lateinit var content: LinearLayout
    private lateinit var selectionBar: LinearLayout
    private lateinit var selectionCount: TextView
    private lateinit var addButton: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        profile = intent.getIntExtra(EXTRA_PROFILE, 1).coerceAtLeast(1)
        current = intent.getStringExtra(EXTRA_CURRENT)
        buildUi()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (selecting) setSelecting(false) else finish()
            }
        })

        intent.getStringExtra(EXTRA_FILTER)?.let { search.setText(it) }
        val debug = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (debug && savedInstanceState == null) intent.getStringExtra(EXTRA_DEMO_GROUP)?.let { name ->
            val g = Tabs.addGroup(this, profile, name, Tabs.GROUP_COLORS[3])
            Tabs.setGroup(this, profile, Tabs.list(this, profile).filter { it.group == null }.take(2).map { it.id }, g.id)
        }
        if (savedInstanceState == null) when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_SELECT -> {
                setSelecting(true)
                if (intent.getBooleanExtra(EXTRA_SELECT_ALL, false)) {
                    selected += Tabs.list(this, profile).map { it.id }
                }
            }
            MODE_NEW_GROUP -> groupDialog(null) { g ->
                intent.getStringExtra(EXTRA_ADD)?.let { Tabs.setGroup(this, profile, listOf(it), g.id) }
                render()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    // --- Действия ---

    private fun switchTo(tab: OpenTab) {
        startActivity(Intent(this, BrowserActivity::class.java)
            .putExtra(BrowserActivity.EXTRA_PROFILE, profile)
            .putExtra(BrowserActivity.EXTRA_SITE, tab.id))
        finish()
    }

    private fun newTab(group: String? = null) {
        startActivity(Intent(this, BrowserActivity::class.java)
            .putExtra(BrowserActivity.EXTRA_PROFILE, profile)
            .putExtra(BrowserActivity.EXTRA_ACTION, BrowserActivity.ACTION_NEW_TAB)
            .apply { if (group != null) putExtra(BrowserActivity.EXTRA_GROUP, group) })
        finish()
    }

    private fun close(ids: Collection<String>) {
        Tabs.close(this, profile, ids.toList())
        selected.removeAll(ids.toSet())
        render()
    }

    private fun closeAll() {
        val n = Tabs.count(this, profile)
        if (n == 0) {
            Toast.makeText(this, Tr.t("no_tabs_to_close"), Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle(Tr.t("close_all_tabs"))
            .setMessage(Tr.t("close_all_q", n))
            .setPositiveButton(Tr.t("close")) { _, _ ->
                Tabs.closeAll(this, profile)
                selected.clear()
                setSelecting(false)
                Toast.makeText(this, Tr.t("tabs_closed"), Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun setSelecting(on: Boolean) {
        selecting = on
        if (!on) selected.clear()
        render()
    }

    private fun toggle(tab: OpenTab) {
        if (!selected.remove(tab.id)) selected += tab.id
        render()
    }

    /** Выбор группы для вкладок: существующие группы или новая. */
    private fun pickGroup(ids: List<String>) {
        if (ids.isEmpty()) return
        val groups = Tabs.groups(this, profile)
        val labels = (groups.map { it.name } + Tr.t("new_tab_group")).toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(Tr.t("add_to_group"))
            .setItems(labels) { _, i ->
                if (i < groups.size) {
                    Tabs.setGroup(this, profile, ids, groups[i].id)
                    setSelecting(false)
                } else groupDialog(null) { g ->
                    Tabs.setGroup(this, profile, ids, g.id)
                    setSelecting(false)
                }
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    /** Создать или изменить группу: название и цвет из палитры. */
    private fun groupDialog(group: TabGroup?, onDone: (TabGroup) -> Unit = { render() }) {
        val name = EditText(this).apply {
            hint = Tr.t("group_name_hint")
            setText(group?.name ?: "")
            setSingleLine()
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        var color = group?.color ?: Tabs.GROUP_COLORS[Tabs.groups(this, profile).size % Tabs.GROUP_COLORS.size]
        // Палитра — две строки по 4 круга, чтобы все цвета были видны на узком экране.
        val swatches = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun renderSwatches() {
            swatches.removeAllViews()
            Tabs.GROUP_COLORS.toList().chunked(4).forEach { rowColors ->
              val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
              swatches.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                  .apply { bottomMargin = dp(8) })
              rowColors.forEach { c ->
                row.addView(FrameLayout(this).apply {
                    background = if (c == color) Ui.oval(c, dp(3), Ui.TEXT) else Ui.oval(c)
                    contentDescription = Tr.t("group_color")
                    if (c == color) addView(icon(R.drawable.ic_check, Color.WHITE, 18).apply {
                        layoutParams = FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER)
                    })
                    setOnClickListener { color = c; renderSwatches() }
                }, LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(12) })
              }
            }
        }
        renderSwatches()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(name)
            addView(TextView(context).apply {
                text = Tr.t("group_color")
                textSize = 13f
                setTextColor(Ui.MUTED)
                setPadding(0, dp(14), 0, dp(8))
            })
            addView(swatches)
        }
        AlertDialog.Builder(this)
            .setTitle(if (group == null) Tr.t("new_tab_group") else Tr.t("rename_group"))
            .setView(box)
            .setPositiveButton(Tr.t("save")) { _, _ ->
                val g = if (group == null) Tabs.addGroup(this, profile, name.text.toString(), color)
                else {
                    Tabs.updateGroup(this, profile, group.id, name.text.toString(), color)
                    Tabs.group(this, profile, group.id) ?: group
                }
                onDone(g)
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun groupMenu(anchor: View, g: TabGroup) {
        val inGroup = Tabs.list(this, profile).filter { it.group == g.id }.map { it.id }
        val items = mutableListOf<Pair<String, () -> Unit>>(
            Tr.t("new_tab_in_group") to { newTab(g.id) },
            Tr.t("rename_group") to { groupDialog(g) },
            Tr.t("group_color") to { groupDialog(g) },
        )
        if (inGroup.isNotEmpty()) items += Tr.t("close_group_tabs") to { close(inGroup) }
        items += Tr.t("delete_group") to {
            AlertDialog.Builder(this)
                .setTitle(Tr.t("delete_group"))
                .setMessage(Tr.t("delete_group_msg", g.name))
                .setPositiveButton(Tr.t("delete")) { _, _ -> Tabs.deleteGroup(this, profile, g.id); render() }
                .setNegativeButton(Tr.t("cancel"), null)
                .show()
            Unit
        }
        popup(anchor, items)
    }

    private fun tabMenu(anchor: View, tab: OpenTab) {
        val items = mutableListOf<Pair<String, () -> Unit>>(
            Tr.t("add_to_group") to { pickGroup(listOf(tab.id)) },
        )
        if (tab.group != null) items += Tr.t("ungroup") to {
            Tabs.setGroup(this, profile, listOf(tab.id), null); render()
        }
        items += Tr.t("select") to { selecting = true; selected += tab.id; render() }
        items += Tr.t("close_tab") to { close(listOf(tab.id)) }
        popup(anchor, items)
    }

    private fun mainMenu(anchor: View) = popup(anchor, listOf(
        Tr.t("new_tab") to { newTab() },
        Tr.t("new_tab_group") to { groupDialog(null) },
        Tr.t("select_tabs") to { setSelecting(true) },
        Tr.t("close_all_tabs") to { closeAll() },
    ))

    private fun popup(anchor: View, items: List<Pair<String, () -> Unit>>) {
        val menu = PopupMenu(this, anchor)
        items.forEachIndexed { i, (t, _) -> menu.menu.add(0, i, i, t) }
        menu.setOnMenuItemClickListener { items[it.itemId].second(); true }
        menu.show()
    }

    // --- Отрисовка ---

    private fun render() {
        val tabs = Tabs.list(this, profile)
        val groups = Tabs.groups(this, profile)
        selected.retainAll(tabs.map { it.id }.toSet())

        title.text = if (selecting) Tr.t("select_tabs") else Tr.t("tabs")
        subtitle.text = "${Profiles.get(this, profile).name} · ${Tr.t("tabs_open_n", tabs.size)}"
        addButton.visibility = if (selecting) View.GONE else View.VISIBLE
        selectionBar.visibility = if (selecting) View.VISIBLE else View.GONE
        selectionCount.text = Tr.t("selected_n", selected.size)

        content.removeAllViews()
        content.gravity = Gravity.TOP

        if (tabs.isEmpty() && groups.isEmpty()) {
            emptyState(Tr.t("tabs_empty"), Tr.t("tabs_empty_hint"), withButton = true)
            return
        }

        val q = query.trim().lowercase()
        fun match(t: OpenTab) = q.isEmpty() ||
            Tabs.label(this, t).lowercase().contains(q) || t.url.lowercase().contains(q)
        val known = groups.map { it.id }.toSet()
        val visible = tabs.filter(::match)
        if (q.isNotEmpty() && visible.isEmpty()) {
            emptyState(Tr.t("tabs_not_found"), Tr.t("tabs_not_found_hint", query.trim()), withButton = false)
            return
        }

        var shownGroups = 0
        groups.forEach { g ->
            val inGroup = visible.filter { it.group == g.id }
            if (q.isNotEmpty() && inGroup.isEmpty()) return@forEach
            shownGroups++
            content.addView(groupHeader(g, tabs.count { it.group == g.id }))
            if (inGroup.isEmpty()) content.addView(note(Tr.t("group_empty")))
            else grid(inGroup, g)
        }
        val loose = visible.filter { it.group == null || it.group !in known }
        if (loose.isNotEmpty()) {
            if (shownGroups > 0) content.addView(sectionTitle(Tr.t("other_tabs")))
            grid(loose, null)
        } else if (tabs.isEmpty()) {
            content.addView(sectionTitle(Tr.t("tabs")))
            content.addView(note(Tr.t("tabs_empty")))
        }
    }

    private fun note(text: String) = TextView(this).apply {
        this.text = text
        textSize = 13f
        setTextColor(Ui.MUTED)
        setPadding(dp(4), dp(4), dp(4), dp(12))
    }

    private fun emptyState(head: String, hint: String, withButton: Boolean) {
        content.gravity = Gravity.CENTER
        content.addView(icon(if (withButton) R.drawable.ic_tabs else R.drawable.ic_search, Ui.MUTED, 56).apply {
            layoutParams = LinearLayout.LayoutParams(dp(56), dp(56)).apply { gravity = Gravity.CENTER_HORIZONTAL }
        })
        content.addView(TextView(this).apply {
            text = head
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Ui.TEXT)
            setPadding(0, dp(16), 0, dp(6))
        })
        content.addView(TextView(this).apply {
            text = hint
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Ui.MUTED)
            setPadding(dp(16), 0, dp(16), dp(20))
        })
        if (withButton) content.addView(TextView(this).apply {
            text = Tr.t("new_tab")
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Ui.ON_ACCENT)
            background = Ui.rounded(Ui.ACCENT, dpf(8))
            setPadding(dp(24), 0, dp(24), 0)
            setOnClickListener { newTab() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(44)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
        })
    }

    private fun groupHeader(g: TabGroup, count: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(4), dp(14), 0, dp(8))
        addView(View(context).apply { background = Ui.oval(g.color) },
            LinearLayout.LayoutParams(dp(12), dp(12)).apply { marginEnd = dp(10) })
        addView(TextView(context).apply {
            text = g.name
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        addView(TextView(context).apply {
            text = count.toString()
            textSize = 13f
            setTextColor(Ui.MUTED)
            setPadding(dp(8), 0, dp(8), 0)
        })
        val more = iconButton(R.drawable.ic_more, Tr.t("menu")) { groupMenu(it, g) }
        addView(more, LinearLayout.LayoutParams(dp(34), dp(34)))
        setOnClickListener { groupMenu(more, g) }
    }

    private fun columns(): Int {
        val w = resources.configuration.screenWidthDp
        return when {
            w >= 840 -> 5
            w >= 600 -> 4
            w >= 480 -> 3
            else -> 2
        }
    }

    private fun grid(tabs: List<OpenTab>, group: TabGroup?) {
        val n = columns()
        tabs.chunked(n).forEach { rowTabs ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (i in 0 until n) {
                val lp = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginStart = dp(5); marginEnd = dp(5)
                }
                val tab = rowTabs.getOrNull(i)
                row.addView(if (tab != null) cell(tab, group) else View(this), lp)
            }
            content.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { bottomMargin = dp(10) })
        }
    }

    /** Квадрат вкладки: домен и крестик сверху, крупная буква сайта, заголовок снизу. */
    private fun cell(tab: OpenTab, group: TabGroup?): View {
        val isCurrent = tab.id == current
        val isSelected = tab.id in selected
        val stroke = when {
            isSelected || isCurrent -> Ui.ACCENT
            group != null -> group.color
            else -> Ui.BORDER
        }
        val square = SquareFrame(this).apply {
            background = Ui.rounded(Ui.SURFACE, dpf(12), dp(if (isSelected || isCurrent) 2 else 1), stroke)
            clipToOutline = true
            contentDescription = Tabs.label(context, tab)
            setOnClickListener { if (selecting) toggle(tab) else switchTo(tab) }
            setOnLongClickListener { if (selecting) toggle(tab) else tabMenu(it, tab); true }
        }
        val host = Tabs.host(tab.url)
        val label = Tabs.label(this, tab)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(6), dp(4), dp(10))
        }
        if (group != null) square.addView(View(this).apply { setBackgroundColor(group.color) },
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP))

        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(context).apply {
                text = host
                textSize = 12f
                setTextColor(Ui.MUTED)
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            if (selecting) {
                addView(FrameLayout(context).apply {
                    background = if (isSelected) Ui.oval(Ui.ACCENT) else Ui.oval(Color.TRANSPARENT, dp(2), Ui.MUTED)
                    if (isSelected) addView(icon(R.drawable.ic_check, Ui.ON_ACCENT, 16).apply {
                        layoutParams = FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER)
                    })
                }, LinearLayout.LayoutParams(dp(24), dp(24)).apply { setMargins(dp(6), dp(6), dp(6), dp(6)) })
            } else {
                addView(FrameLayout(context).apply {
                    contentDescription = Tr.t("close_tab")
                    addView(icon(R.drawable.ic_close, Ui.MUTED, 18).apply {
                        layoutParams = FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER)
                    })
                    setOnClickListener { close(listOf(tab.id)) }
                }, LinearLayout.LayoutParams(dp(36), dp(36)))
            }
        }
        body.addView(top)
        body.addView(FrameLayout(this).apply {
            addView(TextView(context).apply {
                text = label.trim().take(1).uppercase()
                textSize = 30f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(if (isCurrent) Ui.ON_ACCENT else Ui.TEXT)
                background = Ui.rounded(if (isCurrent) Ui.ACCENT else Ui.BG, dpf(12))
            }, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        body.addView(TextView(this).apply {
            text = label
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, 0, dp(6), 0)
        })
        square.addView(body, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return square
    }

    private fun buildUi() {
        val back = iconButton(R.drawable.ic_back, Tr.t("back")) { if (selecting) setSelecting(false) else finish() }
        title = TextView(this).apply {
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        subtitle = TextView(this).apply {
            textSize = 12f
            setTextColor(Ui.MUTED)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        addButton = iconButton(R.drawable.ic_add, Tr.t("new_tab")) { newTab() }
        val more = iconButton(R.drawable.ic_more, Tr.t("menu")) { mainMenu(it) }
        val h = dp(40)
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(back, LinearLayout.LayoutParams(h, h))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), 0, dp(8), 0)
                addView(title)
                addView(subtitle)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(addButton, LinearLayout.LayoutParams(h, h).apply { marginEnd = dp(8) })
            addView(more, LinearLayout.LayoutParams(h, h))
        }

        search = EditText(this).apply {
            setSingleLine()
            textSize = 14f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            hint = Tr.t("search_tabs")
            background = null
            inputType = InputType.TYPE_CLASS_TEXT
            setPadding(dp(8), 0, dp(8), 0)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    query = s?.toString().orEmpty()
                    render()
                }
            })
        }
        val searchBox = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), 0, dp(4), 0)
            addView(icon(R.drawable.ic_search, Ui.MUTED, 18))
            addView(search, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        }
        search.setOnFocusChangeListener { _, focused ->
            searchBox.background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1), if (focused) Ui.ACCENT else Ui.BORDER)
        }

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(5), dp(4), dp(5), dp(16))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        }

        // Панель режима выбора: счётчик, «выбрать все», «в группу», «закрыть».
        selectionCount = TextView(this).apply {
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            setPadding(dp(12), 0, dp(8), 0)
        }
        fun textButton(label: String, primary: Boolean, onClick: () -> Unit) = TextView(this).apply {
            text = label
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(12), 0, dp(12), 0)
            setTextColor(if (primary) Ui.ON_ACCENT else Ui.TEXT)
            background = if (primary) Ui.rounded(Ui.ACCENT, dpf(8)) else Ui.rounded(Ui.BG, dpf(8), dp(1))
            setOnClickListener { onClick() }
        }
        selectionBar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.SURFACE)
            setPadding(dp(12), dp(8), dp(12), dp(10))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                addView(iconButton(R.drawable.ic_close, Tr.t("cancel")) { setSelecting(false) }, LinearLayout.LayoutParams(dp(36), dp(36)))
                addView(selectionCount, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
                addView(textButton(Tr.t("select_all"), false) {
                    selected += Tabs.list(this@TabsActivity, profile).map { it.id }; render()
                }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(36)))
            })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                addView(textButton(Tr.t("to_group"), false) { pickGroup(selected.toList()) },
                    LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(8) })
                addView(textButton(Tr.t("close"), true) { close(selected.toList()); setSelecting(false) },
                    LinearLayout.LayoutParams(0, dp(44), 1f))
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = dp(8) })
        }

        val match = LinearLayout.LayoutParams.MATCH_PARENT
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(10), dp(12), dp(8))
                addView(header)
                addView(searchBox, LinearLayout.LayoutParams(match, dp(40)).apply { topMargin = dp(10) })
            })
            addView(scroll, LinearLayout.LayoutParams(match, 0, 1f).apply { setMargins(dp(7), 0, dp(7), 0) })
            addView(selectionBar)
        }
        root.isFocusableInTouchMode = true
        setContentView(root)
        applyEdgeToEdge(root)
        root.requestFocus()
    }

    /** Квадратная ячейка сетки: высота равна ширине. */
    private class SquareFrame(ctx: Context) : FrameLayout(ctx) {
        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            super.onMeasure(widthMeasureSpec, widthMeasureSpec)
        }
    }
}
