package ru.multibrowser

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Избранное: папки (один уровень), закладки, поиск. Закладка открывается в текущем профиле. */
class BookmarksActivity : AppCompatActivity() {

    companion object {
        // Только для отладочной сборки (приёмка): добавить закладку без участия интерфейса.
        private const val DEBUG_ADD_URL = "debug_add_url"
        private const val DEBUG_ADD_TITLE = "debug_add_title"
        private const val DEBUG_ADD_FOLDER = "debug_add_folder"

        fun open(activity: Activity, profileId: Int) {
            activity.startActivity(Intent(activity, BookmarksActivity::class.java)
                .putExtra(BrowserActivity.EXTRA_PROFILE, profileId))
        }

        private fun bookmarkable(url: String) = url.startsWith("https://") || url.startsWith("http://")

        /** Подпись пункта меню браузера: добавить или убрать текущую страницу. */
        fun menuLabel(ctx: Context, url: String): String {
            if (!bookmarkable(url)) return Tr.t("add_favorite")
            val snapshot = Bookmarks.read(ctx) ?: return Tr.t("favorites_storage_unavailable")
            return Tr.t(if (snapshot.items.any { it.url == url }) "fav_remove" else "add_favorite")
        }

        /** Добавить текущую страницу в избранное или убрать её оттуда. */
        fun toggle(ctx: Context, url: String, title: String) {
            val snapshot = Bookmarks.read(ctx)
            val msg = when {
                !bookmarkable(url) -> Tr.t("fav_unavailable")
                snapshot == null -> Tr.t("favorites_storage_unavailable")
                snapshot.items.any { it.url == url } ->
                    Tr.t(if (Bookmarks.removeByUrl(ctx, url)) "fav_removed" else "favorites_storage_unavailable")
                else -> when (Bookmarks.addIfAbsent(ctx, title.ifBlank { Uri.parse(url).host ?: url }, url)) {
                    Bookmarks.AddResult.ADDED, Bookmarks.AddResult.EXISTS -> Tr.t("added_favorite")
                    Bookmarks.AddResult.UNAVAILABLE -> Tr.t("favorites_storage_unavailable")
                }
            }
            Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show()
        }
    }

    private var profileId = 0
    private var folder = Bookmarks.ROOT
    private var query = ""
    private lateinit var titleView: TextView
    private lateinit var newFolderButton: View
    private lateinit var folderMenuButton: View
    private lateinit var search: EditText
    private lateinit var list: LinearLayout

    override fun onResume() {
        super.onResume()
        AppLock.onResume(this)
        render()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("folder", folder)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        profileId = intent.getIntExtra(BrowserActivity.EXTRA_PROFILE, 0)
        folder = savedInstanceState?.getString("folder") ?: Bookmarks.ROOT
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) debugExtras()

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), 0, dp(16), dp(32))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(list, readableWidth())
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
            addView(header(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(searchBox(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply {
                setMargins(dp(16), dp(4), dp(16), dp(4))
            })
            addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        setContentView(root)
        applyEdgeToEdge(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBack()
        })
    }

    private fun debugExtras() {
        val url = intent.getStringExtra(DEBUG_ADD_URL) ?: return
        val f = intent.getStringExtra(DEBUG_ADD_FOLDER).orEmpty()
        if (f.isNotEmpty()) Bookmarks.addFolder(this, f)
        Bookmarks.add(this, intent.getStringExtra(DEBUG_ADD_TITLE).orEmpty(), url, f)
    }

    private fun goBack() {
        when {
            query.isNotEmpty() -> search.setText("")
            folder != Bookmarks.ROOT -> { folder = Bookmarks.ROOT; render() }
            else -> finish()
        }
    }

    private fun header() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(16), dp(12), dp(16), dp(8))
        addView(iconButton(R.drawable.ic_back, Tr.t("back")) { goBack() },
            LinearLayout.LayoutParams(dp(40), dp(40)))
        titleView = TextView(context).apply {
            textSize = 20f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(8), 0, dp(8), 0)
        }
        addView(titleView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        folderMenuButton = iconButton(R.drawable.ic_more, Tr.t("menu")) { folderActions(folder) }
        addView(folderMenuButton, LinearLayout.LayoutParams(dp(40), dp(40)))
        newFolderButton = iconButton(R.drawable.ic_folder_add, Tr.t("new_folder")) {
            folderNameDialog(Tr.t("new_folder"), "") { name ->
                if (Bookmarks.addFolder(this@BookmarksActivity, name)) {
                    render()
                    true
                } else {
                    toast(Tr.t(if (Bookmarks.read(this@BookmarksActivity) == null) "favorites_storage_unavailable" else "fav_folder_exists"))
                    false
                }
            }
        }
        addView(newFolderButton, LinearLayout.LayoutParams(dp(40), dp(40)))
    }

    private fun searchBox() = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setPadding(dp(12), 0, dp(8), 0)
        addView(icon(R.drawable.ic_search, Ui.MUTED, 20))
        search = EditText(context).apply {
            hint = Tr.t("fav_search")
            setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            textSize = 15f
            setTextColor(Ui.TEXT)
            setHintTextColor(Ui.MUTED)
            background = null
            setPadding(dp(10), 0, 0, 0)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    query = s?.toString()?.trim().orEmpty()
                    render()
                }
            })
        }
        addView(search, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
    }

    private fun render() {
        if (!::list.isInitialized) return
        val snapshot = Bookmarks.read(this)
        if (snapshot == null) {
            list.removeAllViews()
            titleView.text = Tr.t("favorites")
            folderMenuButton.visibility = View.GONE
            newFolderButton.visibility = View.GONE
            list.addView(ExtrasUi.hint(this, Tr.t("favorites_storage_unavailable")))
            return
        }
        if (folder != Bookmarks.ROOT && folder !in snapshot.folders) folder = Bookmarks.ROOT
        val inFolder = folder != Bookmarks.ROOT
        titleView.text = if (inFolder) folder else Tr.t("favorites")
        folderMenuButton.visibility = if (inFolder) View.VISIBLE else View.GONE
        newFolderButton.visibility = if (inFolder) View.GONE else View.VISIBLE
        list.removeAllViews()

        if (query.isNotEmpty()) {
            val q = query.lowercase()
            val found = snapshot.items.filter {
                it.title.lowercase().contains(q) || it.url.lowercase().contains(q) || it.folder.lowercase().contains(q)
            }
            if (found.isEmpty()) emptyState(R.drawable.ic_search, Tr.t("fav_nothing_found"), null)
            else found.asReversed().forEach { list.addView(bookmarkRow(it, showFolder = true)) }
            return
        }

        if (inFolder) {
            val items = snapshot.items.filter { it.folder == folder }
            if (items.isEmpty()) emptyState(R.drawable.ic_folder, Tr.t("fav_folder_empty"), Tr.t("fav_folder_empty_hint"))
            else items.asReversed().forEach { list.addView(bookmarkRow(it, showFolder = false)) }
            return
        }

        val all = snapshot.items
        val folders = snapshot.folders
        val items = all.filter { it.folder == Bookmarks.ROOT }
        if (folders.isEmpty() && items.isEmpty()) {
            emptyState(R.drawable.ic_star, Tr.t("favorites_empty"), Tr.t("fav_empty_hint"))
            return
        }
        if (folders.isNotEmpty()) {
            list.addView(sectionTitle(Tr.t("fav_folders")).apply { setPadding(0, dp(12), 0, dp(4)) })
            folders.forEach { f -> list.addView(folderRow(f, all.count { it.folder == f })) }
        }
        if (items.isNotEmpty()) {
            list.addView(sectionTitle(Tr.t("fav_pages")).apply { setPadding(0, dp(if (folders.isEmpty()) 12 else 20), 0, dp(4)) })
            items.asReversed().forEach { list.addView(bookmarkRow(it, showFolder = false)) }
        }
    }

    private fun emptyState(iconRes: Int, title: String, hint: String?) {
        list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(72), dp(24), dp(24))
            addView(icon(iconRes, Ui.ACCENT, 48).apply {
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)).apply { gravity = Gravity.CENTER_HORIZONTAL }
            })
            addView(TextView(context).apply {
                text = title
                textSize = 17f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setTextColor(Ui.TEXT)
                setPadding(0, dp(16), 0, 0)
            })
            if (hint != null) addView(TextView(context).apply {
                text = hint
                textSize = 13f
                gravity = Gravity.CENTER
                setTextColor(Ui.MUTED)
                setPadding(0, dp(8), 0, 0)
            })
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    private fun row(iconRes: Int, title: String, subtitle: String, onClick: () -> Unit, onMore: () -> Unit) =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
            setPadding(dp(12), dp(6), dp(4), dp(6))
            minimumHeight = dp(56)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = dp(6) }
            setOnClickListener { onClick() }
            setOnLongClickListener { onMore(); true }
            addView(icon(iconRes, Ui.ACCENT, 20))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), 0, dp(4), 0)
                addView(TextView(context).apply {
                    text = title
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Ui.TEXT)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
                addView(TextView(context).apply {
                    text = subtitle
                    textSize = 12f
                    setTextColor(Ui.MUTED)
                    maxLines = 1
                    ellipsize = TextUtils.TruncateAt.END
                })
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_more)
                imageTintList = android.content.res.ColorStateList.valueOf(Ui.MUTED)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                contentDescription = Tr.t("menu")
                setOnClickListener { onMore() }
            }, LinearLayout.LayoutParams(dp(40), dp(40)))
        }

    private fun bookmarkRow(b: Bookmark, showFolder: Boolean): View {
        val host = Uri.parse(b.url).host ?: b.url
        val sub = if (showFolder && b.folder.isNotEmpty()) "${b.folder} · $host" else host
        return row(R.drawable.ic_star, b.title, sub, { openBookmark(b) }, { bookmarkActions(b) })
    }

    private fun folderRow(name: String, count: Int) =
        row(R.drawable.ic_folder, name, Tr.t("fav_count", count), { folder = name; render() }, { folderActions(name) })

    private fun openBookmark(b: Bookmark) {
        val i = Intent(this, BrowserActivity::class.java).putExtra(BrowserActivity.EXTRA_URL, b.url)
        if (profileId > 0) i.putExtra(BrowserActivity.EXTRA_PROFILE, profileId)
        startActivity(i)
        finish()
    }

    private fun bookmarkActions(b: Bookmark) {
        val actions = listOf<Pair<String, () -> Unit>>(
            Tr.t("open") to { openBookmark(b) },
            Tr.t("rename") to { renameDialog(b) },
            Tr.t("move_to_folder") to { moveDialog(b) },
            Tr.t("copy_link") to {
                (getSystemService(CLIPBOARD_SERVICE) as? ClipboardManager)
                    ?.setPrimaryClip(ClipData.newPlainText("url", b.url))
                toast(Tr.t("link_copied"))
            },
            Tr.t("delete") to {
                AlertDialog.Builder(this)
                    .setTitle(Tr.t("fav_delete_q", b.title))
                    .setPositiveButton(Tr.t("delete")) { _, _ ->
                        if (!Bookmarks.remove(this, b.id)) toast(Tr.t("favorites_storage_unavailable"))
                        render()
                    }
                    .setNegativeButton(Tr.t("cancel"), null)
                    .show()
            },
        )
        AlertDialog.Builder(this)
            .setTitle(b.title)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun renameDialog(b: Bookmark) {
        val input = textInput(Tr.t("fav_page_name"), b.title)
        val dialog = AlertDialog.Builder(this)
            .setTitle(Tr.t("rename"))
            .setView(wrap(input))
            .setPositiveButton(Tr.t("save"), null)
            .setNegativeButton(Tr.t("cancel"), null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (Bookmarks.rename(this, b.id, input.text.toString().trim())) {
                    dialog.dismiss()
                    render()
                } else toast(Tr.t("favorites_storage_unavailable"))
            }
        }
        dialog.show()
    }

    private fun moveDialog(b: Bookmark) {
        val snapshot = Bookmarks.read(this) ?: run { toast(Tr.t("favorites_storage_unavailable")); return }
        val folders = snapshot.folders
        val targets = listOf(Bookmarks.ROOT) + folders
        val labels = targets.map { if (it == Bookmarks.ROOT) Tr.t("no_folder") else it } + ("+ " + Tr.t("new_folder"))
        AlertDialog.Builder(this)
            .setTitle(Tr.t("move_to_folder"))
            .setSingleChoiceItems(labels.toTypedArray(), targets.indexOf(b.folder)) { d, i ->
                d.dismiss()
                if (i < targets.size) moveTo(b, targets[i])
                else folderNameDialog(Tr.t("new_folder"), "") { name ->
                    if (folders.any { it.equals(name, ignoreCase = true) }) {
                        toast(Tr.t("fav_folder_exists"))
                        false
                    } else moveTo(b, name)
                }
            }
            .setNegativeButton(Tr.t("cancel"), null)
            .show()
    }

    private fun moveTo(b: Bookmark, target: String): Boolean {
        if (target == b.folder) return true
        val saved = Bookmarks.move(this, b.id, target)
        if (saved) toast(Tr.t("fav_moved", if (target == Bookmarks.ROOT) Tr.t("no_folder") else target))
        else toast(Tr.t("favorites_storage_unavailable"))
        render()
        return saved
    }

    private fun folderActions(name: String) {
        if (name == Bookmarks.ROOT) return
        val actions = listOf<Pair<String, () -> Unit>>(
            Tr.t("open") to { folder = name; render() },
            Tr.t("fav_rename_folder") to {
                folderNameDialog(Tr.t("fav_rename_folder"), name) { to ->
                    if (Bookmarks.renameFolder(this, name, to)) {
                        if (folder == name) folder = to.trim()
                        render()
                        true
                    } else {
                        toast(Tr.t(if (Bookmarks.read(this) == null) "favorites_storage_unavailable" else "fav_folder_exists"))
                        false
                    }
                }
            },
            Tr.t("fav_delete_folder") to { deleteFolderDialog(name) },
        )
        AlertDialog.Builder(this)
            .setTitle(name)
            .setItems(actions.map { it.first }.toTypedArray()) { _, i -> actions[i].second() }
            .show()
    }

    private fun deleteFolderDialog(name: String) {
        val snapshot = Bookmarks.read(this) ?: run { toast(Tr.t("favorites_storage_unavailable")); return }
        val count = snapshot.items.count { it.folder == name }
        val done = done@{ keep: Boolean ->
            if (!Bookmarks.removeFolder(this, name, keep)) {
                toast(Tr.t("favorites_storage_unavailable"))
                return@done
            }
            if (folder == name) folder = Bookmarks.ROOT
            render()
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(Tr.t("fav_delete_folder_q", name))
            .setNegativeButton(Tr.t("cancel"), null)
        if (count == 0) {
            dialog.setPositiveButton(Tr.t("delete")) { _, _ -> done(false) }
        } else {
            dialog.setMessage(Tr.t("fav_delete_folder_msg", count))
                .setPositiveButton(Tr.t("fav_delete_all")) { _, _ -> done(false) }
                .setNeutralButton(Tr.t("fav_keep_pages")) { _, _ -> done(true) }
        }
        dialog.show()
    }

    private fun folderNameDialog(title: String, current: String, onSave: (String) -> Boolean) {
        val input = textInput(Tr.t("fav_folder_name"), current)
        val dialog = AlertDialog.Builder(this)
            .setTitle(title)
            .setView(wrap(input))
            .setPositiveButton(Tr.t("save"), null)
            .setNegativeButton(Tr.t("cancel"), null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = input.text.toString().trim()
                if (name.isNotEmpty() && onSave(name)) dialog.dismiss()
            }
        }
        dialog.show()
    }

    private fun textInput(hintText: String, value: String) = EditText(this).apply {
        hint = hintText
        setText(value)
        setSelection(value.length)
        setSingleLine()
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        setTextColor(Ui.TEXT)
        setHintTextColor(Ui.MUTED)
    }

    private fun wrap(view: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(8), dp(20), 0)
        addView(view)
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
