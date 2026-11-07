package ru.multibrowser

import android.content.Context
import android.database.sqlite.SQLiteConstraintException
import android.database.sqlite.SQLiteException
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import ru.multibrowser.SyncIdentityStore.ImportRecord
import ru.multibrowser.SyncIdentityStore.ImportResult
import ru.multibrowser.SyncIdentityStore.LocalRef
import ru.multibrowser.SyncIdentityStore.LocalSnapshot
import ru.multibrowser.SyncIdentityStore.Scope
import ru.multibrowser.SyncIdentityStore.UnavailableReason
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncIdentityStoreTest {
    private lateinit var ctx: Context
    private lateinit var store: SyncIdentityStore
    private val name = "sync_identity_test.db"
    private val account1 = "11111111-1111-4111-8111-111111111111"
    private val account2 = "22222222-2222-4222-8222-222222222222"
    private val vault1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val vault2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    private val scope get() = Scope(account1, vault1)
    private fun uuid() = UUID.randomUUID().toString()
    private fun loaded(vararg records: ImportRecord) = LocalSnapshot.Loaded(records.toList())
    private fun applied(result: ImportResult) = result as ImportResult.Applied

    @Before fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        ctx.deleteDatabase(name)
        store = SyncIdentityStore(ctx, name)
    }
    @After fun tearDown() { store.close(); ctx.deleteDatabase(name); ctx.deleteDatabase("sync_other_device.db") }

    @Test fun stableIdentitySurvivesRepeatedAllocationAndDatabaseReopen() {
        val ref = LocalRef.Profile(1)
        val first = store.ensureLocal(scope, ref)
        repeat(3) { assertEquals(first, store.ensureLocal(scope, LocalRef.Profile(1))) }
        store.close(); store = SyncIdentityStore(ctx, name)
        assertEquals(first, store.ensureLocal(scope, ref))
        assertEquals(ref, store.findByRecordId(scope, first)!!.local)
        val parsed = UUID.fromString(first)
        assertEquals(first, parsed.toString()); assertEquals(4, parsed.version()); assertEquals(2, parsed.variant())
    }

    @Test fun twoAccountsAndTwoVaultsKeepTheSameLocalProfileSeparate() {
        val scopes = listOf(Scope(account1, vault1), Scope(account1, vault2), Scope(account2, vault1), Scope(account2, vault2))
        val identities = scopes.map { store.ensureLocal(it, LocalRef.Profile(1)) }
        assertEquals(4, identities.toSet().size)
        for (i in scopes.indices) for (j in scopes.indices) {
            assertEquals(if (i == j) LocalRef.Profile(1) else null, store.findByRecordId(scopes[i], identities[j])?.local)
        }
    }

    @Test fun separateDevicesDoNotMergeTheirProfileOneByNumber() {
        val here = store.ensureLocal(scope, LocalRef.Profile(1))
        SyncIdentityStore(ctx, "sync_other_device.db").use { other ->
            assertNotEquals(here, other.ensureLocal(scope, LocalRef.Profile(1)))
        }
    }

    @Test fun sameLocalKeyAcrossKindsHasDifferentRecordIdentities() {
        val refs = listOf(LocalRef.Profile(1), LocalRef.Note(1L), LocalRef.Favorite("1"), LocalRef.Password(1, "1"))
        assertEquals(4, refs.map { store.ensureLocal(scope, it) }.toSet().size)
    }

    @Test fun passwordGuidsAreScopedToTheLocalProfile() {
        val first = store.ensureLocal(scope, LocalRef.Password(1, "os-1700000000000"))
        val second = store.ensureLocal(scope, LocalRef.Password(2, "os-1700000000000"))
        assertNotEquals(first, second)
        assertEquals(LocalRef.Password(2, "os-1700000000000"), store.findByRecordId(scope, second)!!.local)
    }

    @Test fun localLegacyIdsAreNotInferredToBeGlobalIds() {
        val insideFavorite = uuid()
        val refs = listOf(LocalRef.Profile(12), LocalRef.Note(1700000000000L),
            LocalRef.Password(1, "os-1700000000000"), LocalRef.Favorite("b$insideFavorite"))
        for (ref in refs) {
            val id = store.ensureLocal(scope, ref)
            assertEquals(4, UUID.fromString(id).version())
            assertNotEquals(insideFavorite, id)
            assertEquals(ref, store.findByRecordId(scope, id)!!.local)
        }
    }

    @Test fun explicitValidatedRemoteIdentityCanBeBoundWithoutRenamingTheLocalRecord() {
        val id = uuid(); val ref = LocalRef.Favorite("legacy-local-key")
        val result = applied(store.importMetadata(scope, uuid(), null, loaded(ImportRecord(ref, id))))
        assertEquals(id, result.bindings.single().recordId)
        assertEquals(id, store.find(scope, ref))
        assertEquals(ref, store.findByRecordId(scope, id)!!.local)
    }

    @Test fun noncanonicalOrNonV4GlobalIdsAreRejected() {
        for (bad in listOf("1", "1700000000000", "os-1700000000000", "b${uuid()}",
            "1-1-4-8-1", "11111111-1111-1111-8111-111111111111",
            "11111111-1111-4111-c111-111111111111", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")) {
            assertThrows(IllegalArgumentException::class.java) { Scope(bad, vault1) }
            assertThrows(IllegalArgumentException::class.java) { Scope(account1, bad) }
            assertThrows(IllegalArgumentException::class.java) { ImportRecord(LocalRef.Note(1), bad) }
            assertThrows(IllegalArgumentException::class.java) { store.findByRecordId(scope, bad) }
        }
    }

    @Test fun invalidLocalReferencesFailWithoutNormalization() {
        assertThrows(IllegalArgumentException::class.java) { LocalRef.Profile(0) }
        assertThrows(IllegalArgumentException::class.java) { LocalRef.Note(-1) }
        for (bad in listOf("", "  ", "bad\u0000id", "bad\nid", "\uD800", "x".repeat(513))) {
            assertThrows(IllegalArgumentException::class.java) { LocalRef.Favorite(bad) }
            assertThrows(IllegalArgumentException::class.java) { LocalRef.Password(1, bad) }
        }
    }

    @Test fun repeatedImportIsIdempotentEvenIfMetadataInputOrderChanges() {
        val id = uuid()
        val records = listOf(ImportRecord(LocalRef.Profile(1)), ImportRecord(LocalRef.Password(1, "os-7")), ImportRecord(LocalRef.Note(7)))
        val first = applied(store.importMetadata(scope, id, null, LocalSnapshot.Loaded(records)))
        val replay = applied(store.importMetadata(scope, id, null, LocalSnapshot.Loaded(records.reversed())))
        assertFalse(first.replayed); assertTrue(replay.replayed)
        assertEquals(first.bindings, replay.bindings)
        assertEquals(id, store.checkpoint(scope)); assertEquals(3, store.bindings(scope).size)
    }

    @Test fun changedMetadataCannotReuseAnImportOperation() {
        val op = uuid(); val first = loaded(ImportRecord(LocalRef.Profile(1)))
        store.importMetadata(scope, op, null, first)
        assertThrows(SyncIdentityStore.CheckpointMismatch::class.java) {
            store.importMetadata(scope, op, null, loaded(ImportRecord(LocalRef.Profile(2))))
        }
        assertNull(store.find(scope, LocalRef.Profile(2)))
        assertEquals(op, store.checkpoint(scope))
    }

    @Test fun oldReplayDoesNotRewindANewerCheckpoint() {
        val first = uuid(); val second = uuid(); val one = loaded(ImportRecord(LocalRef.Profile(1)))
        val before = applied(store.importMetadata(scope, first, null, one))
        store.importMetadata(scope, second, first, loaded(ImportRecord(LocalRef.Note(9))))
        val replay = applied(store.importMetadata(scope, first, null, one))
        assertTrue(replay.replayed); assertEquals(before.bindings, replay.bindings)
        assertEquals(second, replay.currentCheckpoint); assertEquals(second, store.checkpoint(scope))
    }

    @Test fun staleBaseCheckpointRejectsANewOperationAtomically() {
        val first = uuid(); store.importMetadata(scope, first, null, LocalSnapshot.Empty)
        assertThrows(SyncIdentityStore.CheckpointConflict::class.java) {
            store.importMetadata(scope, uuid(), null, loaded(ImportRecord(LocalRef.Profile(5))))
        }
        assertNull(store.find(scope, LocalRef.Profile(5))); assertEquals(first, store.checkpoint(scope))
    }

    @Test fun anExistingLocalIdentityCannotBeSilentlyRebound() {
        val ref = LocalRef.Note(4); val old = store.ensureLocal(scope, ref)
        assertThrows(SyncIdentityStore.IdentityConflict::class.java) {
            store.importMetadata(scope, uuid(), null, loaded(ImportRecord(ref, uuid())))
        }
        assertEquals(old, store.find(scope, ref)); assertNull(store.checkpoint(scope))
    }

    @Test fun recordIdentityCannotBeReusedForAnotherKindOrLocalRecord() {
        val existing = store.ensureLocal(scope, LocalRef.Profile(1))
        assertThrows(SyncIdentityStore.IdentityConflict::class.java) {
            store.importMetadata(scope, uuid(), null, loaded(ImportRecord(LocalRef.Note(1), existing)))
        }
        assertNull(store.find(scope, LocalRef.Note(1))); assertNull(store.checkpoint(scope))
        assertEquals(1, store.bindings(scope).size)
    }

    @Test fun duplicateLocalOrGlobalIdentitiesRejectTheWholeSnapshot() {
        val ref = LocalRef.Note(1); val remote = uuid()
        for (records in listOf(listOf(ImportRecord(ref), ImportRecord(ref)),
            listOf(ImportRecord(ref, remote), ImportRecord(LocalRef.Profile(1), remote)))) {
            assertThrows(IllegalArgumentException::class.java) {
                store.importMetadata(scope, uuid(), null, LocalSnapshot.Loaded(records))
            }
            assertTrue(store.bindings(scope).isEmpty()); assertNull(store.checkpoint(scope))
        }
        assertThrows(IllegalArgumentException::class.java) { LocalSnapshot.Loaded(emptyList()) }
    }

    @Test fun storageFailureAtCheckpointRollsBackAllNewBindingsAndTheReceipt() {
        val oldRef = LocalRef.Profile(1); val oldId = store.ensureLocal(scope, oldRef)
        val op = uuid(); val fresh = LocalRef.Note(1700)
        ctx.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { database ->
            database.execSQL("""CREATE TRIGGER fail_identity_checkpoint BEFORE INSERT ON sync_identity_imports
                BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END""")
        }
        val input = loaded(ImportRecord(oldRef), ImportRecord(fresh))
        assertThrows(SQLiteException::class.java) { store.importMetadata(scope, op, null, input) }
        assertEquals(oldId, store.find(scope, oldRef)); assertNull(store.find(scope, fresh))
        assertNull(store.checkpoint(scope)); assertEquals(1, store.bindings(scope).size)
        ctx.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { database -> database.execSQL("DROP TRIGGER fail_identity_checkpoint") }
        val success = applied(store.importMetadata(scope, op, null, input))
        val replay = applied(store.importMetadata(scope, op, null, input))
        assertFalse(success.replayed); assertTrue(replay.replayed); assertEquals(success.bindings, replay.bindings)
        assertEquals(oldId, store.find(scope, oldRef)); assertEquals(op, store.checkpoint(scope))
    }

    @Test fun unavailableSourceNeverAdvancesCheckpointOrCreatesIdsOrChangesLocalBytes() {
        val prefs = ctx.getSharedPreferences("passwords", Context.MODE_PRIVATE)
        prefs.edit().putString("unreadable", "original-encrypted-bytes").commit()
        val original = uuid(); val ref = LocalRef.Password(1, "os-100")
        store.importMetadata(scope, original, null, loaded(ImportRecord(ref)))
        val before = store.bindings(scope)
        for (reason in UnavailableReason.entries) {
            assertEquals(ImportResult.Blocked(reason), store.importMetadata(scope, uuid(), original, LocalSnapshot.Unavailable(reason)))
            assertEquals(original, store.checkpoint(scope)); assertEquals(before, store.bindings(scope))
            assertEquals("original-encrypted-bytes", prefs.getString("unreadable", null))
        }
    }

    @Test fun unavailableSourceDoesNotEvenCreateANewIdentityDatabase() {
        store.close(); ctx.deleteDatabase(name); store = SyncIdentityStore(ctx, name)
        assertFalse(ctx.getDatabasePath(name).exists())
        assertEquals(ImportResult.Blocked(UnavailableReason.KEYSTORE),
            store.importMetadata(scope, uuid(), null, LocalSnapshot.Unavailable(UnavailableReason.KEYSTORE)))
        assertFalse(ctx.getDatabasePath(name).exists())
    }

    @Test fun authoritativeEmptyDoesNotDeleteExistingBindingsOrImplyTombstones() {
        val ref = LocalRef.Note(7); val id = store.ensureLocal(scope, ref); val op = uuid()
        val empty = applied(store.importMetadata(scope, op, null, LocalSnapshot.Empty))
        assertTrue(empty.bindings.isEmpty()); assertEquals(op, store.checkpoint(scope))
        assertEquals(id, store.find(scope, ref)); assertEquals(1, store.bindings(scope).size)
    }

    @Test fun databaseConstraintsEnforceBothDirectionsEvenOutsideTheMappingApi() {
        val ref = LocalRef.Profile(1); val id = store.ensureLocal(scope, ref)
        ctx.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { database ->
            assertThrows(SQLiteConstraintException::class.java) {
                database.execSQL("INSERT INTO sync_identities(account_id,vault_id,kind,local_id,record_id) VALUES(?,?,?,?,?)",
                    arrayOf(account1, vault1, "profile", "1", uuid()))
            }
            assertThrows(SQLiteConstraintException::class.java) {
                database.execSQL("INSERT INTO sync_identities(account_id,vault_id,kind,local_id,record_id) VALUES(?,?,?,?,?)",
                    arrayOf(account1, vault1, "note", "2", id))
            }
        }
        assertEquals(id, store.find(scope, ref)); assertEquals(1, store.bindings(scope).size)
    }

    @Test fun databaseWithUnsupportedVersionIsNotResetToAnEmptyStore() {
        val id = store.ensureLocal(scope, LocalRef.Profile(1)); store.close()
        ctx.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { it.version = 2 }
        store = SyncIdentityStore(ctx, name)
        assertThrows(SQLiteException::class.java) { store.bindings(scope) }
        store.close()
        ctx.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { database ->
            database.rawQuery("SELECT record_id FROM sync_identities WHERE local_id='1'", null).use { cursor ->
                assertTrue(cursor.moveToFirst()); assertEquals(id, cursor.getString(0))
            }
        }
    }
}
