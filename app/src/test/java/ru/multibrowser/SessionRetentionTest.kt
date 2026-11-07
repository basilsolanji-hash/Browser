package ru.multibrowser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionRetentionTest {
    @Test fun switchingAcrossMoreProfilesThanLimitKeepsTheirPages() {
        val keys = (1..15).map { "$it:mail" }
        assertNull(SessionRetention.evictionCandidate(keys, keys.toSet()) { false })
    }

    @Test fun evictsOldBackgroundTabInsteadOfAnotherProfilesCurrentPage() {
        val keys = listOf("1:mail", "2:old", "3:draft", "2:current")
        assertEquals("2:old", SessionRetention.evictionCandidate(
            keys, setOf("1:mail", "3:draft", "2:current"),
        ) { false })
    }

    @Test fun neverEvictsSignInEvenWhenEverySessionIsProtected() {
        val keys = listOf("1:login", "2:verify", "3:current")
        assertNull(SessionRetention.evictionCandidate(keys, setOf("3:current")) { it != "3:current" })
    }

    @Test fun preservesLeastRecentlyUsedOrderAmongEligibleTabs() {
        assertEquals("1:old", SessionRetention.evictionCandidate(
            listOf("2:current", "1:old", "1:new"), setOf("2:current"),
        ) { false })
    }

    @Test fun removedProfileDoesNotLeaveProtectedSession() {
        assertEquals("1:old", SessionRetention.evictionCandidate(listOf("1:old"), emptySet()) { false })
    }
}
