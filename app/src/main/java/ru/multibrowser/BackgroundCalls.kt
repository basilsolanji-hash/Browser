package ru.multibrowser

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.core.content.ContextCompat
import org.mozilla.geckoview.GeckoSession

/** Tracks actual engine capture, never permission grants or page URLs. No persistence. */
internal object BackgroundCalls {
    const val RESUME = "resume_microphone_call"
    internal data class Target(val profile: Int?, val pin: String?, val token: String = java.util.UUID.randomUUID().toString(), val close: () -> Unit)
    internal val calls = CaptureRegistry<Any, Target>()

    fun watch(ctx: Context, session: GeckoSession, profile: Int? = null, pin: String? = null) {
        val app = ctx.applicationContext
        val target = Target(profile, pin) { Gecko.closeSession(session) }
        session.mediaDelegate = object : GeckoSession.MediaDelegate {
            override fun onRecordingStatusChanged(
                source: GeckoSession,
                devices: Array<out GeckoSession.MediaDelegate.RecordingDevice>,
            ) {
                if (source.mediaDelegate !== this) return
                val microphone = devices.any {
                    it.type == GeckoSession.MediaDelegate.RecordingDevice.Type.MICROPHONE &&
                        it.status == GeckoSession.MediaDelegate.RecordingDevice.Status.RECORDING
                }
                source.setPriorityHint(if (microphone) GeckoSession.PRIORITY_HIGH else GeckoSession.PRIORITY_DEFAULT)
                calls.update(source, target, microphone)
                refresh(app)
            }
        }
    }

    fun isRecording(session: GeckoSession?) = session != null && calls.contains(session)

    fun forget(ctx: Context, session: GeckoSession) {
        calls.remove(session)
        session.mediaDelegate = null
        if (session.isOpen) session.setPriorityHint(GeckoSession.PRIORITY_DEFAULT)
        refresh(ctx.applicationContext)
    }

    private fun refresh(ctx: Context) {
        if (calls.isEmpty) {
            ctx.stopService(Intent(ctx, MicrophoneCallService::class.java))
        } else if (permitted(ctx)) {
            runCatching {
                ContextCompat.startForegroundService(ctx, Intent(ctx, MicrophoneCallService::class.java))
            }.onFailure { unavailable(ctx) }
        }
    }

    fun permitted(ctx: Context) = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED

    fun endCall(ctx: Context, token: String?) {
        val target = calls.removeMatching { it.token == token } ?: return
        target.close()
        refresh(ctx.applicationContext)
    }

    fun endAll(ctx: Context, stopService: Boolean = true) {
        val targets = calls.drain()
        targets.forEach { it.close() }
        if (stopService) ctx.stopService(Intent(ctx, MicrophoneCallService::class.java))
    }

    fun returnIntent(ctx: Context): Intent = Intent(ctx, BrowserActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        putExtra(BrowserActivity.EXTRA_ACTION, RESUME)
        calls.latest()?.let { target ->
            target.profile?.let { putExtra(BrowserActivity.EXTRA_PROFILE, it) }
            target.pin?.let { putExtra(BrowserActivity.EXTRA_SITE, it) }
        }
        // No URL: reopening the live document must never initiate another navigation.
    }

    fun unavailable(ctx: Context) {
        Toast.makeText(ctx, Tr.t("call_background_unavailable"), Toast.LENGTH_LONG).show()
    }
}
