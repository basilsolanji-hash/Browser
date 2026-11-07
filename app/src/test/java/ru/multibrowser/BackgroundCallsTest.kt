package ru.multibrowser

import android.Manifest
import android.app.Application
import android.app.Notification
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BackgroundCallsTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()

    @Before fun prepare() {
        BackgroundCalls.calls.drain()
        Tr.lang = "en"
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
    }

    @After fun clear() { BackgroundCalls.calls.drain() }

    @Test fun noMicrophoneDoesNotLeaveForegroundServiceRunning() {
        val controller = Robolectric.buildService(MicrophoneCallService::class.java).create()
        val service = controller.get()
        assertEquals(android.app.Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
        assertTrue(shadowOf(service).isStoppedBySelf)
        assertNull(shadowOf(service).lastForegroundNotification)
        controller.destroy()
    }

    @Test fun captureStartsMicrophoneServiceWithPrivateNotificationAndNoNavigationUrl() {
        BackgroundCalls.calls.update(Any(), BackgroundCalls.Target(8, "tab-secret") {}, true)
        val controller = Robolectric.buildService(MicrophoneCallService::class.java).create()
        val service = controller.get()
        service.onStartCommand(null, 0, 1)
        val notification = shadowOf(service).lastForegroundNotification!!
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
        assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertEquals(Tr.t("call_background_active"), notification.extras.getCharSequence(Notification.EXTRA_TEXT))
        assertFalse(notification.extras.toString().contains("tab-secret"))
        val target = BackgroundCalls.returnIntent(app)
        assertEquals(8, target.getIntExtra(BrowserActivity.EXTRA_PROFILE, -1))
        assertEquals("tab-secret", target.getStringExtra(BrowserActivity.EXTRA_SITE))
        assertFalse(target.hasExtra(BrowserActivity.EXTRA_URL))
        assertNull(target.data)
        controller.destroy()
    }

    @Test fun notificationEndClosesOnlyItsCallAndStaleActionsAreHarmless() {
        var closes = 0
        val first = BackgroundCalls.Target(null, null) { closes++ }
        val second = BackgroundCalls.Target(null, null) { closes++ }
        BackgroundCalls.calls.update("first", first, true)
        BackgroundCalls.calls.update("second", second, true)
        val controller = Robolectric.buildService(MicrophoneCallService::class.java).create()
        val action = Intent().setAction(MicrophoneCallService.STOP)
            .putExtra(MicrophoneCallService.TOKEN, first.token)
        controller.get().onStartCommand(action, 0, 1)
        assertEquals(1, closes)
        assertTrue(BackgroundCalls.calls.contains("second"))
        controller.get().onStartCommand(action, 0, 2)
        assertEquals(1, closes)
        controller.get().onStartCommand(Intent().setAction(MicrophoneCallService.STOP)
            .putExtra(MicrophoneCallService.TOKEN, second.token), 0, 3)
        assertEquals(2, closes)
        assertTrue(BackgroundCalls.calls.isEmpty)
        controller.destroy()
    }

    @Test fun revokedMicrophonePermissionCannotStartCaptureService() {
        var closed = false
        BackgroundCalls.calls.update(Any(), BackgroundCalls.Target(1, "start") { closed = true }, true)
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO)
        val controller = Robolectric.buildService(MicrophoneCallService::class.java).create()
        controller.get().onStartCommand(null, 0, 1)
        assertTrue(closed)
        assertTrue(BackgroundCalls.calls.isEmpty)
        assertNull(shadowOf(controller.get()).lastForegroundNotification)
        controller.destroy()
    }

    @Test fun privateCallReturnDoesNotExposeProfileOrUrl() {
        BackgroundCalls.calls.update(Any(), BackgroundCalls.Target(null, null) {}, true)
        val target = BackgroundCalls.returnIntent(app)
        assertEquals(BackgroundCalls.RESUME, target.getStringExtra(BrowserActivity.EXTRA_ACTION))
        assertFalse(target.hasExtra(BrowserActivity.EXTRA_PROFILE))
        assertFalse(target.hasExtra(BrowserActivity.EXTRA_SITE))
        assertFalse(target.hasExtra(BrowserActivity.EXTRA_URL))
    }
}
