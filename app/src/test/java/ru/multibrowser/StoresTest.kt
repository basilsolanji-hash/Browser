package ru.multibrowser

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Хранилища на устройстве: профили, вкладки, история, заметки, статистика, первый запуск. */
@RunWith(RobolectricTestRunner::class)
class StoresTest {
    private lateinit var ctx: Context

    @Before
    fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        Tr.lang = "en"
    }

    // --- Профили ---

    @Test
    fun defaultOrderIsSequential() = assertEquals((1..Settings.profileCount(ctx)).toList(), Profiles.order(ctx))

    @Test
    fun moveProfileDownAndUp() {
        Profiles.move(ctx, 1, 2)
        assertEquals(listOf(2, 3, 1), Profiles.order(ctx).take(3))
        Profiles.move(ctx, 1, -2)
        assertEquals(listOf(1, 2, 3), Profiles.order(ctx).take(3))
    }

    @Test
    fun moveBeyondEdgesIsClamped() {
        Profiles.move(ctx, 1, -5)
        assertEquals(1, Profiles.order(ctx).first())
        val last = Profiles.order(ctx).last()
        Profiles.move(ctx, last, 99)
        assertEquals(last, Profiles.order(ctx).last())
    }

    @Test
    fun savedOrderIgnoresUnknownAndAppendsMissing() {
        Profiles.setOrder(ctx, listOf(3, 99, 3, 1))
        val order = Profiles.order(ctx)
        assertEquals(listOf(3, 1), order.take(2))
        assertEquals(Settings.profileCount(ctx), order.size)
        assertEquals(order.size, order.toSet().size)
    }

    @Test
    fun renameAndDefaultName() {
        Profiles.rename(ctx, 2, "  Bank  ")
        assertEquals("Bank", Profiles.get(ctx, 2).name)
        Profiles.rename(ctx, 2, "   ")
        assertEquals(Tr.t("profile_n", 2), Profiles.get(ctx, 2).name)
    }

    @Test
    fun descriptionStoredAndCleared() {
        Profiles.setDescription(ctx, 3, " Work mail ")
        assertEquals("Work mail", Profiles.get(ctx, 3).description)
        Profiles.setDescription(ctx, 3, "")
        assertEquals("", Profiles.get(ctx, 3).description)
    }

    @Test
    fun localizedExampleNameFollowsLanguage() {
        Profiles.rename(ctx, 4, "@ex_work_name")
        Tr.lang = "en"; assertEquals("Work", Profiles.get(ctx, 4).name)
        Tr.lang = "ru"; assertEquals("Работа", Profiles.get(ctx, 4).name)
        Tr.lang = "en"
    }

    @Test
    fun colorsDifferForNeighbours() {
        (1..49).forEach { assertTrue("$it", Profiles.color(it) != Profiles.color(it + 1)) }
    }

    @Test
    fun lastProfileFallsBackToFirst() {
        assertEquals(Profiles.order(ctx).first(), Profiles.lastProfile(ctx))
        Profiles.saveLastProfile(ctx, 5)
        assertEquals(5, Profiles.lastProfile(ctx))
        Profiles.saveLastProfile(ctx, 999)
        assertEquals(Profiles.order(ctx).first(), Profiles.lastProfile(ctx))
    }

    // --- Закреплённые вкладки: общий набор и свой у профиля ---

    @Test
    fun defaultPinIsStart() {
        val pins = Pins.all(ctx)
        assertEquals(1, pins.size)
        assertEquals(Pins.START, pins[0].url)
    }

    @Test
    fun profileUsesCommonUntilEdited() {
        Pins.add(ctx, "Mail", "mail.google.com")
        assertFalse(Pins.hasOwn(ctx, 2))
        assertEquals(Pins.all(ctx).map { it.id }, Pins.all(ctx, 2).map { it.id })
        Pins.add(ctx, "CRM", "crm.example.com", 2)
        assertTrue(Pins.hasOwn(ctx, 2))
        assertEquals(3, Pins.all(ctx, 2).size)
        assertEquals(2, Pins.all(ctx).size)
        assertEquals(2, Pins.all(ctx, 3).size)
    }

    @Test
    fun pinIdsUnique() {
        repeat(20) { Pins.add(ctx, "T$it", "t$it.com") }
        val ids = Pins.all(ctx).map { it.id }
        assertEquals(ids.size, ids.toSet().size)
    }

    @Test
    fun useCommonResets() {
        Pins.add(ctx, "X", "x.com", 5)
        Pins.useCommon(ctx, 5)
        assertFalse(Pins.hasOwn(ctx, 5))
    }

    @Test
    fun addNormalizesUrl() {
        Pins.add(ctx, "Site", "example.com")
        assertEquals("https://example.com", Pins.all(ctx).last().url)
    }

    @Test
    fun removeLastKeepsDefault() {
        Pins.all(ctx).forEach { Pins.remove(ctx, it.id) }
        assertEquals(1, Pins.all(ctx).size)
    }

    @Test
    fun moveAndResolveFallback() {
        Pins.add(ctx, "A", "a.com")
        val a = Pins.all(ctx).last()
        Pins.move(ctx, a.id, -1)
        assertEquals(a.id, Pins.all(ctx).first().id)
        assertEquals(Pins.all(ctx).first().id, Pins.resolve(ctx, "gone").id)
    }

    @Test
    fun localizedPinTitle() {
        Pins.save(ctx, listOf(Pin("mail", "@tab_mail", "https://mail.google.com/")), 6)
        Tr.lang = "ru"; assertEquals("Почта", Pins.all(ctx, 6)[0].title)
        Tr.lang = "en"; assertEquals("Mail", Pins.all(ctx, 6)[0].title)
    }

    // --- Открытые вкладки (блок A) ---

    @Test
    fun tabsAddUpdateClose() {
        val t = Tabs.add(ctx, 1, "https://a.com")
        assertTrue(Tabs.isTab(t.id))
        assertEquals(1, Tabs.count(ctx, 1))
        Tabs.update(ctx, 1, t.id, title = "A", url = "https://a.com/x")
        assertEquals("https://a.com/x", Tabs.byId(ctx, 1, t.id)!!.url)
        Tabs.close(ctx, 1, listOf(t.id))
        assertEquals(0, Tabs.count(ctx, 1))
    }

    @Test
    fun tabsArePerProfile() {
        Tabs.add(ctx, 1, "https://a.com")
        Tabs.add(ctx, 2, "https://b.com")
        Tabs.add(ctx, 2, "https://c.com")
        assertEquals(1, Tabs.count(ctx, 1))
        assertEquals(2, Tabs.count(ctx, 2))
        Tabs.closeAll(ctx, 2)
        assertEquals(0, Tabs.count(ctx, 2))
        assertEquals(1, Tabs.count(ctx, 1))
    }

    @Test
    fun tabResolveFallsBackToProfilePins() {
        Pins.save(ctx, listOf(Pin("start", "Start", Pins.START), Pin("crm", "CRM", "https://crm.x")), 3)
        assertEquals("start", Tabs.resolve(ctx, 3, "tab_missing").id)
        assertEquals("crm", Tabs.resolve(ctx, 3, "crm").id)
    }

    @Test
    fun groupsAssignAndDelete() {
        val t = Tabs.add(ctx, 1, "https://a.com")
        val g = Tabs.addGroup(ctx, 1, "Work", 0xFFE53935.toInt())
        Tabs.setGroup(ctx, 1, listOf(t.id), g.id)
        assertEquals(g.id, Tabs.byId(ctx, 1, t.id)!!.group)
        Tabs.deleteGroup(ctx, 1, g.id)
        assertNull(Tabs.group(ctx, 1, g.id))
    }

    // --- История, заметки, статистика ---

    @Test
    fun historySkipsDuplicatesAndLogins() {
        History.add(ctx, 1, "https://a.com")
        History.add(ctx, 1, "https://a.com")
        History.add(ctx, 1, "https://accounts.google.com/signin")
        History.add(ctx, 1, "os:start")
        assertEquals(1, History.list(ctx, 1).size)
    }

    @Test
    fun historyIsCappedAndPerProfile() {
        repeat(320) { History.add(ctx, 1, "https://a.com/$it") }
        assertEquals(300, History.list(ctx, 1).size)
        assertEquals("https://a.com/319", History.list(ctx, 1).first().url)
        assertTrue(History.list(ctx, 2).isEmpty())
    }

    @Test
    fun statsCountPagesPerProfile() {
        History.add(ctx, 1, "https://a.com")
        History.add(ctx, 1, "https://b.com")
        History.add(ctx, 2, "https://c.com")
        assertEquals(2, Stats.pages(ctx, 1))
        assertEquals(1, Stats.pages(ctx, 2))
        Stats.reset(ctx)
        assertEquals(0, Stats.pages(ctx, 1))
    }

    @Test
    fun trackersBufferedAndFlushed() {
        repeat(25) { Stats.trackerBlocked(ctx) }
        assertEquals(25L, Stats.trackers(ctx))
        Stats.flush(ctx)
        assertEquals(25L, Stats.trackers(ctx))
    }

    @Test
    fun notesAddUpdateRemove() {
        Notes.add(ctx, "first", "https://a.com")
        Notes.add(ctx, "second")
        assertEquals(2, Notes.list(ctx).size)
        val n = Notes.list(ctx).first { it.text == "first" }
        Notes.update(ctx, n.id, "edited")
        assertNotNull(Notes.list(ctx).firstOrNull { it.text == "edited" })
        Notes.remove(ctx, n.id)
        assertEquals(1, Notes.list(ctx).size)
    }

    // --- Первый запуск ---

    @Test
    fun onboardingSeedsExamplesOnFreshInstall() {
        assertTrue(Onboarding.shouldShow(ctx))
        assertEquals("@ex_personal_name", ctx.getSharedPreferences("profiles", 0).getString("name_1", null))
        assertTrue(Pins.hasOwn(ctx, 2))
        assertEquals(3, Pins.all(ctx, 2).size)
        Onboarding.finish(ctx)
        assertFalse(Onboarding.shouldShow(ctx))
    }

    @Test
    fun onboardingSkippedForExistingUsers() {
        Profiles.rename(ctx, 1, "Mine")
        assertFalse(Onboarding.shouldShow(ctx))
        assertEquals("Mine", Profiles.get(ctx, 1).name)
    }
}
