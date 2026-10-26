package ru.multibrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.mozilla.geckoview.GeckoSession.ContentDelegate.ContextElement

/** Меню долгого нажатия: что считается ссылкой, картинкой и когда меню не показывается. */
class LinkMenuTest {
    private val none = ContextElement.TYPE_NONE
    private val image = ContextElement.TYPE_IMAGE

    @Test
    fun plainLink() {
        val t = LinkMenu.Target.from("https://bsuir.by/m/12.pdf", "  Радиоприёмные\n устройства ", null, none, null)!!
        assertEquals("https://bsuir.by/m/12.pdf", t.link)
        assertEquals("Радиоприёмные устройства", t.linkText)
        assertTrue(t.webLink)
        assertFalse(t.hasMedia)
    }

    @Test
    fun imageInsideLink() {
        val t = LinkMenu.Target.from("https://example.com/a", null, "https://example.com/p.jpg", image, "Фото")!!
        assertTrue(t.webLink)
        assertTrue(t.hasMedia)
        assertEquals("https://example.com/p.jpg", t.media)
        assertEquals("Фото", t.title)
    }

    @Test
    fun imageWithoutLink() {
        val t = LinkMenu.Target.from(null, null, "https://example.com/p.png", image, null)!!
        assertNull(t.link)
        assertTrue(t.hasMedia)
    }

    @Test
    fun noMenuForScriptsAndInlineData() {
        assertNull(LinkMenu.Target.from("javascript:void(0)", "x", null, none, null))
        assertNull(LinkMenu.Target.from(null, null, "data:image/png;base64,AAAA", image, null))
        assertNull(LinkMenu.Target.from(null, null, "blob:https://example.com/1", image, null))
        assertNull(LinkMenu.Target.from(null, null, null, none, null))
    }

    @Test
    fun mailAndPhoneAreCopyOnly() {
        val t = LinkMenu.Target.from("mailto:hello@os-browser.com", "Написать", null, none, null)!!
        assertFalse(t.webLink)
        assertEquals("mailto:hello@os-browser.com", t.link)
    }

    @Test
    fun blankTextIsDropped() {
        val t = LinkMenu.Target.from("https://example.com", "   ", null, none, "  ")!!
        assertNull(t.linkText)
        assertNull(t.title)
    }
}
