package ru.multibrowser

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class DiagPrivacyTest {
    @Test fun urlsRetainOnlyOriginAndNotOAuthOrCredentials() {
        assertEquals("начало: https://example.com", Diag.redact("начало: https://alice:password@example.com/oauth?code=UNIQUE_CODE&state=PRIVATE#id_token=TOKEN"))
        assertEquals("ошибка 1/2: https://example.com", Diag.redact("ошибка 1/2: https://example.com/user@example.com?email=private@example.com"))
    }
    @Test fun appAndLocalAddressesDoNotLeakTheirContents() {
        val input = "intent://target/#Intent;scheme=sample;S.secret=PRIVATE_INTENT;end data:text/html,PRIVATE_DATA file:///storage/private.pdf"
        val output = Diag.redact(input)
        assertFalse(output.contains("PRIVATE"))
        assertFalse(output.contains("private.pdf"))
        assertTrue(output.contains("intent:[redacted]"))
    }
    @Test fun plainEmailIsNotKeptInNotificationsDiagnostics() {
        assertEquals("показано: example.com ([redacted])", Diag.redact("показано: example.com (alice@example.com)"))
    }
    @Test fun bothVisibleDiagnosticsAndLogcatUseRedactedText() {
        Diag.log("privacy-test", "ошибка: https://alice:password@example.com/oauth?code=UNIQUE_CODE_DIAG#TOKEN_DIAG")
        val output = Diag.text()
        val log = ShadowLog.getLogsForTag("OsDiag").last().msg
        for (value in listOf(output, log)) {
            assertFalse(value.contains("UNIQUE_CODE_DIAG"))
            assertFalse(value.contains("TOKEN_DIAG"))
            assertFalse(value.contains("alice:password"))
            assertTrue(value.contains("https://example.com"))
        }
    }
}
