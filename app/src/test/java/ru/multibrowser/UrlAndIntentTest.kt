package ru.multibrowser

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import java.io.File

/** Адресная строка и быстрый поиск: что пользователь ввёл → какой адрес откроется. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class SearchToUrlTest(private val input: String, private val expected: String) {

    companion object {
        private const val Q = "https://duckduckgo.com/?q="

        @JvmStatic
        @Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf(
            "https://example.com" to "https://example.com",
            "http://example.com" to "http://example.com",
            "  https://example.com  " to "https://example.com",
            "example.com" to "https://example.com",
            "example.org/path?q=1" to "https://example.org/path?q=1",
            "sub.domain.co.uk" to "https://sub.domain.co.uk",
            "ru.wikipedia.org" to "https://ru.wikipedia.org",
            "mail.google.com" to "https://mail.google.com",
            "localhost:8080" to "${Q}localhost%3A8080",
            "192.168.0.1" to "https://192.168.0.1",
            "hello" to "${Q}hello",
            "hello world" to "${Q}hello+world",
            "погода москва" to "${Q}%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B0+%D0%BC%D0%BE%D1%81%D0%BA%D0%B2%D0%B0",
            "what is 2+2" to "${Q}what+is+2%2B2",
            "c++ tutorial" to "${Q}c%2B%2B+tutorial",
            "a & b" to "${Q}a+%26+b",
            "file.txt is big" to "${Q}file.txt+is+big",
            "100%" to "${Q}100%25",
            "#hashtag" to "${Q}%23hashtag",
            "x.y z" to "${Q}x.y+z",
            "日本語" to "${Q}%E6%97%A5%E6%9C%AC%E8%AA%9E",
            "مرحبا" to "${Q}%D9%85%D8%B1%D8%AD%D8%A8%D8%A7",
            "claude.ai" to "https://claude.ai",
            "HTTPS://EXAMPLE.COM" to "HTTPS://EXAMPLE.COM",
            "a.b" to "https://a.b",
        ).map { arrayOf<Any>(it.first, it.second) }
    }

    @Test
    fun toUrl() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        Search.set(ctx, "ddg")
        assertEquals(expected, Search.toUrl(ctx, input))
    }
}

/** Ось — браузер по умолчанию: какие ссылки из других приложений пускаем, а какие отбрасываем. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class IncomingUrlTest(private val name: String, private val url: String, private val allowed: Boolean) {

    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf(
            arrayOf("https", "https://example.com/page", true),
            arrayOf("http", "http://example.com", true),
            arrayOf("https-query", "https://example.com/?a=1&b=2#x", true),
            arrayOf("HTTPS-upper", "HTTPS://EXAMPLE.COM", true),
            arrayOf("start", "os:start", true),
            arrayOf("javascript", "javascript:alert(1)", false),
            arrayOf("data", "data:text/html,<b>x</b>", false),
            arrayOf("content", "content://com.other/secret", false),
            arrayOf("file-root", "file:///etc/hosts", false),
            arrayOf("file-sdcard", "file:///sdcard/Download/x.pdf", false),
            arrayOf("intent", "intent://scan/#Intent;scheme=zxing;end", false),
            arrayOf("ftp", "ftp://example.com/file", false),
            arrayOf("about", "about:config", false),
            arrayOf("chrome", "chrome://settings", false),
            arrayOf("resource", "resource://android/assets/reader/reader.js", false),
            arrayOf("blob", "blob:https://example.com/uuid", false),
            arrayOf("os-other", "os:settings", false),
            arrayOf("tel", "tel:+100", false),
            arrayOf("mailto", "mailto:a@b.c", false),
        )
    }

    @Test
    fun viewIntent() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        val result = DefaultBrowser.incomingUrl(ctx, intent)
        if (allowed) assertEquals(url, result) else assertNull("$name должен отбрасываться", result)
    }
}

/** Свои сохранённые страницы открываются по file://, чужие файлы — нет (в том числе через ../). */
@RunWith(org.robolectric.RobolectricTestRunner::class)
class SavedPageFileTest {
    private val ctx = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun ownSavedPageAllowed() {
        val f = File(SavedPages.dir(ctx), "page_1.pdf").apply { writeText("x") }
        val url = Uri.fromFile(f).toString()
        assertEquals(url, DefaultBrowser.incomingUrl(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(url))))
    }

    @Test
    fun downloadedFileViewAllowed() {
        val f = File(Downloads.viewDir(ctx), "report.pdf").apply { writeText("x") }
        val url = Uri.fromFile(f).toString()
        assertEquals(url, DefaultBrowser.incomingUrl(ctx, Intent().putExtra(BrowserActivity.EXTRA_URL, url)))
    }

    @Test
    fun traversalOutOfSavedRejected() {
        val url = "file://" + SavedPages.dir(ctx).path + "/../shared_prefs/profiles.xml"
        assertNull(DefaultBrowser.incomingUrl(ctx, Intent(Intent.ACTION_VIEW, Uri.parse(url))))
    }

    @Test
    fun extraUrlAlsoFiltered() {
        val i = Intent().putExtra(BrowserActivity.EXTRA_URL, "javascript:alert(1)")
        assertNull(DefaultBrowser.incomingUrl(ctx, i))
        val ok = Intent().putExtra(BrowserActivity.EXTRA_URL, "https://example.com")
        assertEquals("https://example.com", DefaultBrowser.incomingUrl(ctx, ok))
    }
}

/** Режим чтения: метка в адресе и возврат к исходному адресу. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class ReaderUrlTest(private val url: String, private val wrapped: String) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf(
            "https://a.com/x" to "https://a.com/x#os-reader",
            "https://a.com/x#section" to "https://a.com/x#os-reader",
            "https://a.com/?q=1" to "https://a.com/?q=1#os-reader",
            "https://a.com/x#os-reader" to "https://a.com/x#os-reader",
            "http://b.org" to "http://b.org#os-reader",
        ).map { arrayOf<Any>(it.first, it.second) }
    }

    @Test
    fun wrapAndBack() {
        val w = Reader.wrap(url)
        assertEquals(wrapped, w)
        assertEquals(true, Reader.isReader(w))
        assertEquals(wrapped.removeSuffix("#os-reader"), Reader.original(w))
        assertEquals(false, Reader.isReader(Reader.original(w)))
    }
}

/** Прошлые запросы для подсказок адресной строки — из адресов страниц результатов. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class SearchQueryOfTest(private val url: String, private val expected: String?) {

    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun cases(): List<Array<Any?>> = listOf(
            "https://duckduckgo.com/?q=hello+world" to "hello world",
            "https://duckduckgo.com/?q=%D0%BF%D0%BE%D0%B3%D0%BE%D0%B4%D0%B0&ia=web" to "погода",
            "https://duckduckgo.com/?t=h_&q=c%2B%2B" to "c++",
            "https://www.google.com/search?q=weather&hl=ru" to "weather",
            "https://yandex.ru/search/?text=%D1%80%D0%BF%D1%82%D0%BC&lr=213" to "рптм",
            "https://www.bing.com/search?q=news#top" to "news",
            "https://search.brave.com/search?q=brave" to "brave",
            "https://www.startpage.com/sp/search?query=start" to "start",
            "https://duckduckgo.com/" to null,
            "https://duckduckgo.com/?q=" to null,
            "https://duckduckgo.com/?q=+++" to null,
            "https://example.com/?q=test" to null,
            "https://www.google.com/maps?q=paris" to null,
            "https://yandex.ru/search/?lr=213" to null,
        ).map { arrayOf(it.first, it.second) }
    }

    @Test
    fun query() = assertEquals(expected, Search.queryOf(url))
}

/** Страницы входа не выгружаются и не восстанавливаются сами — иначе сайт шлёт код повторно. */
@RunWith(ParameterizedRobolectricTestRunner::class)
class SignInPageTest(private val url: String, private val expected: Boolean) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun cases(): List<Array<Any>> = listOf(
            "https://appleid.apple.com/auth/authorize?client_id=x" to true,
            "https://accounts.google.com/v3/signin/challenge/pwd" to true,
            "https://login.microsoftonline.com/common/oauth2" to true,
            "https://example.com/account/login" to true,
            "https://github.com/sessions/two-factor" to true,
            "https://claude.ai/login" to true,
            "https://example.com/" to false,
            "https://en.wikipedia.org/wiki/Moon" to false,
            "https://mail.google.com/mail/u/0/" to false,
            "" to false,
        ).map { arrayOf(it.first, it.second) }
    }

    @Test
    fun detect() = assertEquals(expected, Gecko.isSignInPage(url))
}
