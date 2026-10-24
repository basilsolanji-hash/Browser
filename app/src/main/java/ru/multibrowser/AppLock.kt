package ru.multibrowser

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.graphics.Typeface
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat

/**
 * Защита приложения: вход по отпечатку/лицу или PIN-коду телефона после паузы,
 * и (по желанию) скрытие содержимого в списке недавних приложений и на скриншотах.
 */
object AppLock {
    private const val TIMEOUT_MS = 60_000L

    private var unlocked = false
    private var backgroundSince = 0L

    fun deviceSecure(activity: AppCompatActivity) =
        activity.getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

    /** Вызывать в onResume каждого экрана. */
    fun onResume(activity: AppCompatActivity) {
        if (Settings.hideContent(activity)) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        if (backgroundSince != 0L) {
            if (SystemClock.elapsedRealtime() - backgroundSince > TIMEOUT_MS) unlocked = false
            backgroundSince = 0L
        }
        if (Settings.lockEnabled(activity) && deviceSecure(activity) && !unlocked) showLock(activity)
    }

    private var started = 0

    /** Приложение целиком ушло в фон, когда остановлен последний его экран (а не при переходе между экранами). */
    fun register(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) {
                started++
            }

            override fun onActivityStopped(activity: Activity) {
                started--
                if (started == 0) backgroundSince = SystemClock.elapsedRealtime()
            }

            override fun onActivityCreated(activity: Activity, state: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    // Идёт ли сейчас запрос биометрии — чтобы на повороте не открыть второй поверх первого.
    private var authenticating = false

    private fun showLock(activity: AppCompatActivity) {
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        if (content.findViewWithTag<View>(TAG) != null) return
        val cover = FrameLayout(activity).apply {
            tag = TAG
            setBackgroundColor(Ui.BG)
            isClickable = true // перехватываем касания, чтобы под крышкой ничего не нажималось
            addView(LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                addView(ImageView(activity).apply { setImageResource(R.drawable.ic_wordmark) },
                    LinearLayout.LayoutParams(activity.dp(140), activity.dp(42)))
                addView(TextView(activity).apply {
                    text = Tr.t("unlock")
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setTextColor(Ui.ON_ACCENT)
                    background = Ui.rounded(Ui.ACCENT, activity.dpf(6))
                    setOnClickListener { prompt(activity) }
                }, LinearLayout.LayoutParams(activity.dp(220), activity.dp(46)).apply { topMargin = activity.dp(28) })
            }, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER,
            ))
        }
        content.addView(cover, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // Пока крышка видна, «Назад» не трогает экран под ней, а сворачивает приложение.
        val back = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                activity.moveTaskToBack(true)
            }
        }
        activity.onBackPressedDispatcher.addCallback(activity, back)
        cover.setTag(R.id.app_lock_back, back)

        cover.post { prompt(activity) }
    }

    private fun prompt(activity: AppCompatActivity) {
        if (activity.isFinishing || activity.isDestroyed || authenticating) return
        authenticating = true
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    authenticating = false
                    unlocked = true
                    // Снимаем крышку и перехват «Назад» именно с текущего (не уничтоженного поворотом) экрана.
                    val top = activity.findViewById<ViewGroup>(android.R.id.content)
                    top.findViewWithTag<View>(TAG)?.let { cover ->
                        (cover.getTag(R.id.app_lock_back) as? OnBackPressedCallback)?.remove()
                        top.removeView(cover)
                    }
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    authenticating = false
                }
            })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Ось")
                .setSubtitle(Tr.t("confirm_you"))
                .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
                .build()
        )
    }

    private const val TAG = "app_lock_cover"
}
