package ru.multibrowser

/** In-memory aggregate: stopping one microphone must not stop another active call. */
internal class CaptureRegistry<K, V> {
    private val entries = LinkedHashMap<K, V>()
    val isEmpty get() = entries.isEmpty()
    fun contains(key: K) = entries.containsKey(key)
    fun latest(): V? = entries.values.lastOrNull()
    fun update(key: K, value: V, recording: Boolean) {
        if (recording) entries[key] = value else entries.remove(key)
    }
    fun remove(key: K) { entries.remove(key) }
    fun removeMatching(matches: (V) -> Boolean): V? {
        val entry = entries.entries.firstOrNull { matches(it.value) } ?: return null
        return entries.remove(entry.key)
    }
    fun drain(): List<V> = entries.values.toList().also { entries.clear() }
}
