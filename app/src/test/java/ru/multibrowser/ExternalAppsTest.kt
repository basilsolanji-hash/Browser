package ru.multibrowser

import android.content.Intent
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExternalAppsTest {
    private val own = "ru.multibrowser.test"

    @Test fun customAppLinkPreservesDataWithoutAddingAuthority() {
        val link = ExternalApps.parse("tg://resolve?domain=example", own)!!
        assertEquals("tg://resolve?domain=example", link.uri.toString())
        assertNull(link.targetPackage)
        assertNull(link.fallback)
    }

    @Test fun parsedIntentNeverSuppliesActionComponentFlagsOrExtrasToLaunch() {
        val raw = "intent://target/path#Intent;scheme=sample;package=com.example.receiver;" +
            "action=android.intent.action.SEND;category=android.intent.category.LAUNCHER;" +
            "component=com.example.receiver/.Private;launchFlags=0x10000003;S.secret=PRIVATE;end"
        val link = ExternalApps.parse(raw, own)!!
        val launch = ExternalApps.intent(link)
        assertEquals(Intent.ACTION_VIEW, launch.action)
        assertEquals(setOf(Intent.CATEGORY_BROWSABLE), launch.categories)
        assertEquals("sample://target/path", launch.dataString)
        assertEquals("com.example.receiver", launch.`package`)
        assertNull(launch.component)
        assertNull(launch.selector)
        assertNull(launch.extras)
        assertNull(launch.clipData)
        assertEquals(0, launch.flags)
    }

    @Test fun fallbackIsDecodedExactlyOnceAndRemainsInTheBrowser() {
        val web = "https://example.com/fallback?next=%2Fprivate"
        val raw = "intent://target/#Intent;scheme=sample;package=com.example.receiver;S.browser_fallback_url=${Uri.encode(web)};end"
        assertEquals(web, ExternalApps.parse(raw, own)!!.fallback)
        assertNull(ExternalApps.intent(ExternalApps.parse(raw, own)!!).extras)
    }

    @Test fun recursiveOrCredentialedFallbackCannotBeUsed() {
        for (bad in listOf("intent://evil/#Intent;scheme=sample;end", "javascript:alert(1)", "file:///secret", "https://user:pass@example.com/", "https:///missing", "https://example.com/\nsecret")) {
            val raw = "intent://target/#Intent;scheme=sample;package=com.example.receiver;S.browser_fallback_url=${Uri.encode(bad)};end"
            assertNull(bad, ExternalApps.parse(raw, own)!!.fallback)
        }
    }

    @Test fun unsafeEffectiveSchemesAreDeniedEvenInsideAnIntent() {
        for (scheme in listOf("file", "content", "data", "javascript", "about", "blob", "android-app", "android.resource", "resource", "os", "chrome", "view-source")) {
            assertNull(scheme, ExternalApps.parse("$scheme://target/secret", own))
            assertNull(scheme, ExternalApps.parse("intent://target/#Intent;scheme=$scheme;end", own))
        }
    }

    @Test fun malformedAndSelfPackagesAreDenied() {
        for (pkg in listOf("ru.multibrowser", own, "android", "bad package", ".invalid", "com..invalid")) {
            assertNull(pkg, ExternalApps.parse("intent://target/#Intent;scheme=sample;package=$pkg;end", own))
        }
    }

    @Test fun invalidOrOversizedLinksCannotLaunch() {
        assertNull(ExternalApps.parse("intent://target/#Intent;scheme=sample;package=com.example.receiver", own))
        assertNull(ExternalApps.parse("sample://target/" + "x".repeat(8192), own))
        assertNull(ExternalApps.parse("sample://target/\u0000secret", own))
    }

    @Test fun httpIntentWithoutAnAppPackageUsesTheExistingWebSession() {
        val link = ExternalApps.parse("intent://example.com/path#Intent;scheme=https;end", own)!!
        assertNull(link.targetPackage)
        assertEquals("https://example.com/path", link.fallback)
    }

    @Test fun browserNavigationIsNotAutomaticallyPassedToAndroid() {
        for (url in listOf("https://example.com", "http://example.com", "about:blank", "os:start", "file:///saved.pdf", "data:text/html,test", "blob:https://example.com/id")) assertFalse(url, ExternalApps.intercepts(url))
        for (url in listOf("intent://target/#Intent;scheme=sample;end", "tg://resolve", "tel:5551234")) assertTrue(url, ExternalApps.intercepts(url))
    }

    @Test fun javascriptLinksStayInGeckoButCannotBecomeNativeIntents() {
        // Existing page controls/bookmarklets belong to Gecko, not the outgoing app dispatcher.
        assertFalse(ExternalApps.intercepts("javascript:void(0)"))
        assertFalse(ExternalApps.intercepts("javascript:window.open('https://example.com')"))
        assertNull(ExternalApps.parse("intent://target/#Intent;scheme=javascript;package=com.example.receiver;end", own))
        assertTrue(ExternalApps.intercepts("tg://resolve?domain=example"))
    }

    @Test fun trustedGestureRequiresAVisibleTopLevelDocument() {
        assertTrue(ExternalApps.eligible(hasGesture = true, visible = true))
        assertFalse(ExternalApps.eligible(hasGesture = false, visible = true))
        assertFalse(ExternalApps.eligible(hasGesture = true, visible = false))
        assertFalse(ExternalApps.eligible(hasGesture = true, visible = true, subframe = true))
    }
}
