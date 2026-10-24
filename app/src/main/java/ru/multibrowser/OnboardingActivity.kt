package ru.multibrowser

import android.graphics.Typeface
import android.os.Bundle
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import kotlin.math.abs

/**
 * Обучение при первом запуске: несколько экранов «что умеет Ось» — листаются пальцем или
 * кнопками «Далее»/«Назад», «Пропустить» — сразу к профилям. Повторно — из «Справки».
 */
class OnboardingActivity : AppCompatActivity() {

    private data class Page(val title: String, val body: String, val art: (LinearLayout) -> Unit)

    private lateinit var pages: List<Page>
    private var index = 0
    private lateinit var art: LinearLayout
    private lateinit var title: TextView
    private lateinit var body: TextView
    private lateinit var dots: LinearLayout
    private lateinit var back: TextView
    private lateinit var next: TextView
    private lateinit var extra: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tr.apply(this)
        Ui.init(this)
        pages = listOf(
            Page(Tr.t("onb1_title"), Tr.t("onb1_body")) { it.addView(wordmark()) },
            Page(Tr.t("onb2_title"), Tr.t("onb2_body")) { it.addView(profilesArt()) },
            Page(Tr.t("onb3_title"), Tr.t("onb3_body")) { it.addView(tabsArt()) },
            Page(Tr.t("onb4_title"), Tr.t("onb4_body")) { it.addView(badge(R.drawable.ic_history)) },
            Page(Tr.t("onb5_title"), Tr.t("onb5_body")) { it.addView(badge(R.drawable.ic_more)) },
            Page(Tr.t("onb6_title"), Tr.t("onb6_body")) { it.addView(badge(R.drawable.ic_lock)) },
        )
        index = savedInstanceState?.getInt("page") ?: 0

        val skip = TextView(this).apply {
            text = Tr.t("onb_skip")
            textSize = 14f
            setTextColor(Ui.MUTED)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setOnClickListener { done() }
        }
        art = LinearLayout(this).apply { gravity = Gravity.CENTER; minimumHeight = dp(140) }
        title = TextView(this).apply {
            textSize = 24f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Ui.TEXT)
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, dp(12))
        }
        body = TextView(this).apply {
            textSize = 15f
            setTextColor(Ui.MUTED)
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.25f)
        }
        extra = ExtrasUi.button(this, Tr.t("default_make")) { DefaultBrowser.request(this) }
        dots = LinearLayout(this).apply { gravity = Gravity.CENTER; setPadding(0, dp(16), 0, dp(16)) }
        back = navButton(Tr.t("onb_back"), accent = false) { go(index - 1) }
        next = navButton(Tr.t("onb_next"), accent = true) { if (index == pages.lastIndex) done() else go(index + 1) }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Ui.BG)
            setPadding(dp(24), dp(8), dp(24), dp(20))
            addView(LinearLayout(context).apply {
                gravity = Gravity.END
                addView(skip)
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                addView(art, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
                addView(title)
                addView(body)
                addView(extra)
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(dots)
            addView(LinearLayout(context).apply {
                addView(back, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(8) })
                addView(next, LinearLayout.LayoutParams(0, dp(48), 1f))
            })
        }
        // Листание пальцем влево/вправо — как в обычном обучении.
        val swipe = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                if (abs(vx) < abs(vy) || abs(vx) < 400) return false
                val forward = (vx < 0) != Tr.isRtl()
                go(index + if (forward) 1 else -1)
                return true
            }
        })
        root.setOnTouchListener { _, e -> swipe.onTouchEvent(e) }
        setContentView(root)
        applyEdgeToEdge(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (index > 0) go(index - 1) else done()
            }
        })
        show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt("page", index)
    }

    private fun go(i: Int) {
        if (i !in pages.indices || i == index) return
        index = i
        show()
    }

    private fun show() {
        val p = pages[index]
        art.removeAllViews()
        p.art(art)
        title.text = p.title
        body.text = p.body
        // На последнем экране — предложение сделать Ось браузером по умолчанию.
        val last = index == pages.lastIndex
        extra.visibility = if (last && !DefaultBrowser.isDefault(this)) View.VISIBLE else View.GONE
        back.visibility = if (index == 0) View.INVISIBLE else View.VISIBLE
        next.text = if (last) Tr.t("onb_start") else Tr.t("onb_next")
        dots.removeAllViews()
        pages.indices.forEach { i ->
            dots.addView(View(this).apply { background = Ui.oval(if (i == index) Ui.ACCENT else Ui.BORDER) },
                LinearLayout.LayoutParams(dp(if (i == index) 10 else 8), dp(if (i == index) 10 else 8)).apply {
                    marginStart = dp(4); marginEnd = dp(4); gravity = Gravity.CENTER_VERTICAL
                })
        }
    }

    private fun done() {
        Onboarding.finish(this)
        finish()
    }

    private fun navButton(label: String, accent: Boolean, onClick: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setTextColor(if (accent) Ui.ON_ACCENT else Ui.TEXT)
        background = if (accent) Ui.rounded(Ui.ACCENT, dpf(6)) else Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setOnClickListener { onClick() }
    }

    // --- Иллюстрации экранов (простые, из элементов интерфейса Оси) ---

    private fun wordmark() = ImageView(this).apply {
        setImageResource(R.drawable.ic_wordmark)
        scaleType = ImageView.ScaleType.FIT_CENTER
        layoutParams = LinearLayout.LayoutParams(dp(220), dp(70))
    }

    private fun badge(res: Int) = LinearLayout(this).apply {
        gravity = Gravity.CENTER
        background = Ui.oval(Ui.SURFACE, dp(1), Ui.BORDER)
        addView(this@OnboardingActivity.icon(res, Ui.ACCENT, 44))
        layoutParams = LinearLayout.LayoutParams(dp(112), dp(112))
    }

    /** Две строки профилей-примеров, как на главном экране. */
    private fun profilesArt() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        listOf(1, 2).forEach { id ->
            val p = Profiles.get(this@OnboardingActivity, id)
            addView(LinearLayout(context).apply {
                gravity = Gravity.CENTER_VERTICAL
                background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
                setPadding(dp(12), dp(10), dp(16), dp(10))
                addView(View(context).apply { background = Ui.oval(p.color) }, LinearLayout.LayoutParams(dp(12), dp(12)))
                addView(TextView(context).apply {
                    text = p.name
                    textSize = 15f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Ui.TEXT)
                    setPadding(dp(10), 0, 0, 0)
                })
            }, LinearLayout.LayoutParams(dp(240), LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
    }

    /** Полоса вкладок профиля: «Старт» выбрана, рядом «Почта». */
    private fun tabsArt() = LinearLayout(this).apply {
        background = Ui.rounded(Ui.SURFACE, dpf(6), dp(1))
        setPadding(dp(4), dp(4), dp(4), dp(4))
        Pins.all(this@OnboardingActivity, 1).take(3).forEachIndexed { i, pin ->
            addView(TextView(context).apply {
                text = pin.title
                textSize = 14f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                setPadding(dp(16), dp(8), dp(16), dp(8))
                background = if (i == 0) Ui.rounded(Ui.ACCENT, dpf(5)) else null
                setTextColor(if (i == 0) Ui.ON_ACCENT else Ui.MUTED)
            })
        }
    }
}
