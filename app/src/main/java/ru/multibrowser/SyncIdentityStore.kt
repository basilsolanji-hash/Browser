package ru.multibrowser

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import android.database.sqlite.SQLiteOpenHelper
import java.io.Closeable
import java.io.DataOutputStream
import java.io.OutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.util.UUID

/**
 * Private transactional identity metadata, not sync transport or storage of personal records/keys.
 * Every operation names its account AND vault; local Gecko/profile IDs remain unchanged.
 */
internal class SyncIdentityStore(
    context: Context,
    databaseName: String = "sync_identity_v1.db",
) : Closeable {
    data class Scope(val accountId: String, val vaultId: String) {
        init { requireSyncUuid(accountId); requireSyncUuid(vaultId) }
    }

    enum class Kind(val wire: String) { PROFILE("profile"), PASSWORD("password"), FAVORITE("favorite"), NOTE("note") }

    sealed class LocalRef {
        abstract val kind: Kind
        internal abstract val storageKey: String

        data class Profile(val profileId: Int) : LocalRef() {
            init { require(profileId > 0) { "Invalid local profile identity" } }
            override val kind get() = Kind.PROFILE
            override val storageKey get() = profileId.toString()
        }
        // A password GUID is only unique inside its local profile, not across the whole device.
        data class Password(val profileId: Int, val guid: String) : LocalRef() {
            init { require(profileId > 0) { "Invalid local profile identity" }; requireLocalSyncToken(guid) }
            override val kind get() = Kind.PASSWORD
            override val storageKey get() = "$profileId:$guid"
        }
        data class Favorite(val localId: String) : LocalRef() {
            init { requireLocalSyncToken(localId) }
            override val kind get() = Kind.FAVORITE
            override val storageKey get() = localId
        }
        data class Note(val noteId: Long) : LocalRef() {
            init { require(noteId > 0) { "Invalid local note identity" } }
            override val kind get() = Kind.NOTE
            override val storageKey get() = noteId.toString()
        }
    }

    /** recordId is explicit import metadata, never inferred from localId/bUUID/os-millis. */
    data class ImportRecord(val local: LocalRef, val recordId: String? = null) {
        init { recordId?.let(::requireSyncUuid) }
    }
    data class Binding(val local: LocalRef, val recordId: String)

    enum class UnavailableReason { KEYSTORE, CORRUPT_DATA, UNSUPPORTED_SCHEMA, STORAGE }
    sealed class LocalSnapshot {
        // Only a future strict reader may assert Empty/Loaded; Passwords.list is not that reader.
        data object Empty : LocalSnapshot()
        data class Loaded(val records: List<ImportRecord>) : LocalSnapshot() {
            init { require(records.isNotEmpty()) { "Use explicit authoritative empty snapshot" } }
        }
        data class Unavailable(val reason: UnavailableReason) : LocalSnapshot()
    }
    sealed class ImportResult {
        data class Applied(
            val operationId: String,
            val currentCheckpoint: String,
            val bindings: List<Binding>,
            val replayed: Boolean,
        ) : ImportResult()
        data class Blocked(val reason: UnavailableReason) : ImportResult()
    }
    class IdentityConflict : IllegalStateException("Identity binding conflicts with existing metadata")
    class CheckpointMismatch : IllegalStateException("Import operation metadata does not match its receipt")
    class CheckpointConflict : IllegalStateException("Import base checkpoint has changed")

    private val helper: SQLiteOpenHelper
    init {
        require(databaseName.matches(Regex("[A-Za-z0-9_.-]+"))) { "Invalid identity database name" }
        helper = object : SQLiteOpenHelper(context.applicationContext, databaseName, null, 1) {
            override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }
            override fun onCreate(db: SQLiteDatabase) {
                db.execSQL("""CREATE TABLE sync_identities (
                    account_id TEXT NOT NULL, vault_id TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('profile','password','favorite','note')),
                    local_id TEXT NOT NULL, record_id TEXT NOT NULL,
                    PRIMARY KEY(account_id,vault_id,kind,local_id),
                    UNIQUE(account_id,vault_id,record_id))""")
                db.execSQL("""CREATE TABLE sync_identity_imports (
                    account_id TEXT NOT NULL, vault_id TEXT NOT NULL,
                    checkpoint TEXT NOT NULL, input_hash BLOB NOT NULL,
                    PRIMARY KEY(account_id,vault_id,checkpoint))""")
                db.execSQL("""CREATE TABLE sync_identity_progress (
                    account_id TEXT NOT NULL, vault_id TEXT NOT NULL, checkpoint TEXT NOT NULL,
                    PRIMARY KEY(account_id,vault_id),
                    FOREIGN KEY(account_id,vault_id,checkpoint)
                      REFERENCES sync_identity_imports(account_id,vault_id,checkpoint))""")
            }
            // Never erase an unknown/corrupt store to make migration appear empty.
            override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
                throw SQLiteException("Unsupported identity database schema")
            }
            override fun onDowngrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
                throw SQLiteException("Unsupported identity database schema")
            }
        }
    }

    @Synchronized fun find(scope: Scope, local: LocalRef): String? = find(helper.readableDatabase, scope, local)
    @Synchronized fun findByRecordId(scope: Scope, recordId: String): Binding? {
        requireSyncUuid(recordId)
        return findByRecordId(helper.readableDatabase, scope, recordId)
    }
    @Synchronized fun bindings(scope: Scope): List<Binding> = helper.readableDatabase.query(
        "sync_identities", arrayOf("kind", "local_id", "record_id"), "account_id=? AND vault_id=?",
        arrayOf(scope.accountId, scope.vaultId), null, null, "kind,local_id",
    ).use { cursor -> buildList { while (cursor.moveToNext()) add(readBinding(cursor)) } }
    @Synchronized fun checkpoint(scope: Scope): String? = checkpoint(helper.readableDatabase, scope)

    /** Stable local allocation only. It does not mutate a password/note or create an outbox entry. */
    @Synchronized fun ensureLocal(scope: Scope, local: LocalRef): String = transaction { db -> bind(db, scope, ImportRecord(local)).recordId }

    /**
     * Atomic import of ID METADATA + its local receipt/checkpoint, not of SharedPreferences content.
     * operationId is a local immutable UUID, not a network cursor. expectedPreviousCheckpoint is CAS.
     * Receipts are retained: replaying an older operation never rewinds the current checkpoint.
     */
    @Synchronized fun importMetadata(
        scope: Scope,
        operationId: String,
        expectedPreviousCheckpoint: String?,
        snapshot: LocalSnapshot,
    ): ImportResult {
        if (snapshot is LocalSnapshot.Unavailable) return ImportResult.Blocked(snapshot.reason)
        requireSyncUuid(operationId)
        expectedPreviousCheckpoint?.let(::requireSyncUuid)
        val records = when (snapshot) {
            LocalSnapshot.Empty -> emptyList()
            is LocalSnapshot.Loaded -> snapshot.records.toList().also {
                require(it.isNotEmpty()) { "Use explicit authoritative empty snapshot" }
            }
            is LocalSnapshot.Unavailable -> error("Unavailable source cannot be imported")
        }
        require(records.size <= 100_000) { "Identity snapshot is too large" }
        require(records.map { it.local }.toSet().size == records.size) { "Duplicate local identities" }
        val explicit = records.mapNotNull { it.recordId }
        require(explicit.toSet().size == explicit.size) { "Duplicate imported record identities" }
        val ordered = records.sortedWith(compareBy({ it.local.kind.wire }, { it.local.storageKey }))
        val hash = fingerprint(scope, expectedPreviousCheckpoint, ordered)
        return transaction { db ->
            val previous = receipt(db, scope, operationId)
            if (previous != null) {
                if (!MessageDigest.isEqual(previous, hash)) throw CheckpointMismatch()
                val current = checkpoint(db, scope) ?: throw SQLiteException("Missing identity import checkpoint")
                val result = ordered.map { record ->
                    Binding(record.local, find(db, scope, record.local) ?: throw SQLiteException("Missing imported identity"))
                }
                ImportResult.Applied(operationId, current, result, replayed = true)
            } else {
                if (checkpoint(db, scope) != expectedPreviousCheckpoint) throw CheckpointConflict()
                val result = ordered.map { bind(db, scope, it) }
                db.insertOrThrow("sync_identity_imports", null, values(scope).apply {
                    put("checkpoint", operationId); put("input_hash", hash)
                })
                db.insertWithOnConflict("sync_identity_progress", null, values(scope).apply {
                    put("checkpoint", operationId)
                }, SQLiteDatabase.CONFLICT_REPLACE).also {
                    if (it == -1L) throw SQLiteException("Could not save identity import checkpoint")
                }
                ImportResult.Applied(operationId, operationId, result, replayed = false)
            }
        }
    }

    private fun bind(db: SQLiteDatabase, scope: Scope, record: ImportRecord): Binding {
        val old = find(db, scope, record.local)
        if (old != null) {
            if (record.recordId != null && record.recordId != old) throw IdentityConflict()
            return Binding(record.local, old)
        }
        val id = record.recordId ?: UUID.randomUUID().toString()
        if (findByRecordId(db, scope, id) != null) throw IdentityConflict()
        db.insertOrThrow("sync_identities", null, values(scope).apply {
            put("kind", record.local.kind.wire); put("local_id", record.local.storageKey); put("record_id", id)
        })
        return Binding(record.local, id)
    }
    private fun find(db: SQLiteDatabase, scope: Scope, local: LocalRef): String? = db.query(
        "sync_identities", arrayOf("record_id"), "account_id=? AND vault_id=? AND kind=? AND local_id=?",
        arrayOf(scope.accountId, scope.vaultId, local.kind.wire, local.storageKey), null, null, null,
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0).also(::requireStoredSyncUuid) else null }
    private fun findByRecordId(db: SQLiteDatabase, scope: Scope, recordId: String): Binding? = db.query(
        "sync_identities", arrayOf("kind", "local_id", "record_id"), "account_id=? AND vault_id=? AND record_id=?",
        arrayOf(scope.accountId, scope.vaultId, recordId), null, null, null,
    ).use { if (it.moveToFirst()) readBinding(it) else null }
    private fun checkpoint(db: SQLiteDatabase, scope: Scope): String? = db.query(
        "sync_identity_progress", arrayOf("checkpoint"), "account_id=? AND vault_id=?",
        arrayOf(scope.accountId, scope.vaultId), null, null, null,
    ).use { if (it.moveToFirst()) it.getString(0).also(::requireStoredSyncUuid) else null }
    private fun receipt(db: SQLiteDatabase, scope: Scope, operationId: String): ByteArray? = db.query(
        "sync_identity_imports", arrayOf("input_hash"), "account_id=? AND vault_id=? AND checkpoint=?",
        arrayOf(scope.accountId, scope.vaultId, operationId), null, null, null,
    ).use { if (it.moveToFirst()) it.getBlob(0) else null }
    private fun values(scope: Scope) = ContentValues().apply { put("account_id", scope.accountId); put("vault_id", scope.vaultId) }
    private fun readBinding(cursor: Cursor): Binding = try {
        val key = cursor.getString(1)
        val local = when (cursor.getString(0)) {
            "profile" -> LocalRef.Profile(key.toInt())
            "password" -> LocalRef.Password(key.substringBefore(':').toInt(), key.substringAfter(':', ""))
            "favorite" -> LocalRef.Favorite(key)
            "note" -> LocalRef.Note(key.toLong())
            else -> throw IllegalArgumentException()
        }
        require(local.storageKey == key)
        val id = cursor.getString(2); requireSyncUuid(id)
        Binding(local, id)
    } catch (_: IllegalArgumentException) { throw SQLiteException("Invalid stored identity metadata") }

    private inline fun <T> transaction(block: (SQLiteDatabase) -> T): T {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            val result = block(db)
            db.setTransactionSuccessful()
            return result
        } finally { db.endTransaction() }
    }
    @Synchronized override fun close() = helper.close()

    companion object {
        /** Canonical local metadata only: fixed field order, length-prefixed UTF-8, input order normalized. */
        private fun fingerprint(scope: Scope, previous: String?, records: List<ImportRecord>): ByteArray {
            val digest = MessageDigest.getInstance("SHA-256")
            val sink = object : OutputStream() {
                override fun write(value: Int) = Unit
                override fun write(buffer: ByteArray, offset: Int, length: Int) = Unit
            }
            DataOutputStream(DigestOutputStream(sink, digest)).use { out ->
                fun field(value: String?) {
                    if (value == null) out.writeInt(-1)
                    else { val bytes = value.toByteArray(Charsets.UTF_8); out.writeInt(bytes.size); out.write(bytes) }
                }
                field("os-sync-identity-import-v1"); field(scope.accountId); field(scope.vaultId); field(previous)
                out.writeInt(records.size)
                records.forEach { field(it.local.kind.wire); field(it.local.storageKey); field(it.recordId) }
            }
            return digest.digest()
        }
    }
}

private val syncUuidPattern = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
private fun requireSyncUuid(value: String) {
    require(syncUuidPattern.matches(value)) { "Canonical UUIDv4 required" }
    val uuid = UUID.fromString(value)
    require(uuid.toString() == value && uuid.version() == 4 && uuid.variant() == 2) { "Canonical UUIDv4 required" }
}
private fun requireStoredSyncUuid(value: String) {
    try { requireSyncUuid(value) } catch (_: IllegalArgumentException) { throw SQLiteException("Invalid stored identity metadata") }
}
private fun requireLocalSyncToken(value: String) {
    require(value.length in 1..512 && value.isNotBlank() && value.none { it.code < 0x20 || it.code == 0x7f } &&
        Charsets.UTF_8.newEncoder().canEncode(value)) { "Invalid local identity token" }
}
