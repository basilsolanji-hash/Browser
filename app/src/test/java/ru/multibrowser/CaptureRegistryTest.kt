package ru.multibrowser

import org.junit.Assert.*
import org.junit.Test

class CaptureRegistryTest {
    @Test fun endingOneProfileDoesNotStopAnotherProfilesMicrophone() {
        val calls = CaptureRegistry<String, Int>()
        calls.update("profile1", 1, true)
        calls.update("profile2", 2, true)
        calls.update("profile1", 1, false)
        assertFalse(calls.isEmpty)
        assertTrue(calls.contains("profile2"))
        assertEquals(2, calls.latest())
    }

    @Test fun closeOrCrashRemovesTheLastCall() {
        val calls = CaptureRegistry<String, Int>()
        calls.update("session", 1, true)
        calls.remove("session")
        assertTrue(calls.isEmpty)
    }

    @Test fun repeatedRecordingEventsDoNotDuplicateEndActions() {
        val calls = CaptureRegistry<String, Int>()
        repeat(3) { calls.update("session", 7, true) }
        assertEquals(listOf(7), calls.drain())
        assertTrue(calls.drain().isEmpty())
    }

    @Test fun inactiveDevicesNeverCreateAnOngoingCall() {
        val calls = CaptureRegistry<String, Int>()
        calls.update("session", 7, false)
        assertNull(calls.latest())
        assertTrue(calls.isEmpty)
    }
}
