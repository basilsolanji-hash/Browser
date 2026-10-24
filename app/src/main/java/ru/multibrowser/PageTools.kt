package ru.multibrowser

import android.app.Activity
import android.app.role.RoleManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.view.MenuItem
import android.widget.Toast
import org.mozilla.geckoview.BasicSelectionActionDelegate
import org.mozilla.geckoview.GeckoSession

/**
 * Инструменты страницы для экрана браузера (блоки D, F): режим чтения, сохранение офлайн,
 * заметки, справка, действия с выделенным текстом. BrowserActivity подключает их парой строк.
 *
 * @param profile — id профиля текущей вкладки или null в инкогнито (тогда не пишем адрес в заметку).
 */
class PageTools(
    private val a: Activity,
    private val session: () -> GeckoSession?,
    private val url: () -> String,
    private val profile: () -> Int?,
) {
    /** Подпись пункта меню режима чтения: войти или выйти. */
    fun readerTitle() = Tr.t(if (Reader.isReader(url())) "reader_exit" else "reader_mode")

    /** Делегат выделения для новой вкладки: копировать, поделиться, поиск, «Добавить в заметку». */
    fun textActions(): GeckoSession.SelectionActionDelegate = TextActions(a) { if (profile() == null) "" else url() }

    fun toggleReader() {
        val s = session() ?: return
        val u = url()
        when {
            Reader.isReader(u) -> s.loadUri(Reader.original(u))
            u.startsWith("http://") || u.startsWith("https://") -> s.loadUri(Reader.wrap(u))
            else -> toast(Tr.t("web_only"))
        }
    }

    fun savePage() {
        val s = session() ?: return
        val u = Reader.original(url())
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            toast(Tr.t("web_only"))
            return
        }
        val title = profile()?.let { id -> History.list(a, id).firstOrNull { it.url == u }?.title?.takeIf { it.isNotBlank() } }
            ?: Uri.parse(u).host ?: u
        toast(Tr.t("saving_page"))
        Diag.log("save", "saveAsPdf: $u")
        val ctx = a.applicationContext
        s.saveAsPdf().accept({ pdf ->
            if (pdf == null) {
                Diag.log("save", "saveAsPdf: пустой результат")
                toast(Tr.t("save_failed"))
                return@accept
            }
            Thread {
                val r = runCatching { SavedPages.store(ctx, title, u, pdf) }
                Diag.log("save", r.fold({ "сохранено: ${it.file}, ${it.size} Б" }, { "запись: ${it.message}" }))
                a.runOnUiThread { toast(Tr.t(if (r.isSuccess) "page_saved" else "save_failed")) }
            }.start()
        }, { e ->
            Diag.log("save", "saveAsPdf: ${e?.message}")
            toast(Tr.t("save_failed"))
        })
    }

    private fun toast(text: String) {
        if (!a.isFinishing) Toast.makeText(a, text, Toast.LENGTH_SHORT).show()
    }
}

/**
 * Режим чтения (№34). about:reader в GeckoView нет, поэтому его делает встроенное расширение
 * (assets/reader): метка #os-reader в адресе — переход внутри страницы, скрипт подменяет её статьёй.
 */
object Reader {
    private const val MARK = "#os-reader"

    fun isReader(url: String) = url.endsWith(MARK)

    fun wrap(url: String) = url.substringBefore('#') + MARK

    /** Исходный адрес страницы (для адресной строки и выхода из режима чтения — полная перезагрузка). */
    fun original(url: String): String = url.removeSuffix(MARK)
}

/**
 * Панель над выделенным текстом (№37): стандартные действия движка (копировать, выделить всё…)
 * плюс «Поделиться», «Поиск» и «Добавить в заметку».
 */
private class TextActions(private val activity: Activity, private val pageUrl: () -> String) :
    BasicSelectionActionDelegate(activity) {

    companion object {
        const val SHARE = "ru.multibrowser.SHARE"
        const val SEARCH = "ru.multibrowser.SEARCH"
        const val NOTE = "ru.multibrowser.NOTE"
        // «Добавить в заметку» — сразу после «Копировать», чтобы не пряталась в переполнение панели.
        val OURS = listOf(NOTE, SHARE, SEARCH)
    }

    private val selected get() = mSelection?.text?.trim().orEmpty()

    override fun getAllActions(): Array<String> {
        val base = super.getAllActions().toMutableList()
        val at = base.indexOf(GeckoSession.SelectionActionDelegate.ACTION_COPY).let { if (it < 0) 0 else it + 1 }
        base.addAll(at, OURS)
        return base.toTypedArray()
    }

    override fun isActionAvailable(id: String): Boolean =
        if (id in OURS) selected.isNotEmpty() else super.isActionAvailable(id)

    override fun prepareAction(id: String, item: MenuItem) {
        when (id) {
            SHARE -> item.title = Tr.t("share")
            SEARCH -> item.title = Tr.t("search_web")
            NOTE -> item.title = Tr.t("add_to_note")
            else -> super.prepareAction(id, item)
        }
    }

    override fun performAction(id: String, item: MenuItem): Boolean {
        if (id !in OURS) return super.performAction(id, item)
        val text = selected
        when (id) {
            SHARE -> runCatching {
                activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, text)
                }, Tr.t("share")))
            }
            SEARCH -> mSession?.loadUri(Search.queryUrl(activity, text))
            NOTE -> {
                Notes.add(activity, text, Reader.original(pageUrl()).takeIf { it.startsWith("http") } ?: "")
                Toast.makeText(activity, Tr.t("note_added"), Toast.LENGTH_SHORT).show()
            }
        }
        runCatching { mSelection?.unselect() }
        mActionMode?.finish()
        return true
    }
}

/** Ось как браузер по умолчанию (№26): входящие ссылки и системный запрос роли. */
object DefaultBrowser {
    /**
     * Адрес, с которым открыли экран: ссылка из другого приложения или наш экстра. Экран открыт
     * для других приложений, поэтому пропускаем только веб-адреса, стартовую страницу и свои
     * сохранённые страницы — никаких javascript:, content: и чужих файлов.
     */
    fun incomingUrl(ctx: Context, intent: Intent): String? {
        val raw = if (intent.action == Intent.ACTION_VIEW && intent.data != null) intent.dataString
        else intent.getStringExtra(BrowserActivity.EXTRA_URL)
        val uri = raw?.let { Uri.parse(it) } ?: return null
        return when (uri.scheme?.lowercase()) {
            "http", "https" -> raw
            // Свои файлы: сохранённые страницы и скачанные файлы, открытые для просмотра в Оси.
            "file" -> raw.takeIf {
                val path = java.io.File(uri.path ?: return@takeIf false).canonicalPath
                listOf(SavedPages.dir(ctx), Downloads.viewDir(ctx)).any { path.startsWith(it.canonicalPath + "/") }
            }
            else -> raw.takeIf { it == Pins.START }
        }
    }

    fun isDefault(a: Activity): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            a.getSystemService(RoleManager::class.java)?.let { rm ->
                if (rm.isRoleAvailable(RoleManager.ROLE_BROWSER)) return rm.isRoleHeld(RoleManager.ROLE_BROWSER)
            }
        }
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))
        val info = a.packageManager.resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY)
        return info?.activityInfo?.packageName == a.packageName
    }

    /** Системный диалог «Сделать браузером по умолчанию», а где его нет — экран приложений по умолчанию. */
    fun request(a: Activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rm = a.getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_BROWSER) && !rm.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                @Suppress("DEPRECATION")
                runCatching { a.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_BROWSER), 4207) }
                    .onSuccess { return }
            }
        }
        runCatching { a.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) }
            .onFailure { runCatching { a.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) } }
    }
}

/** Копирование в буфер с подтверждением (для экранов блоков D–F). */
fun Activity.copyText(label: String, text: String) {
    getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText(label, text))
    Toast.makeText(this, Tr.t("copied"), Toast.LENGTH_SHORT).show()
}
