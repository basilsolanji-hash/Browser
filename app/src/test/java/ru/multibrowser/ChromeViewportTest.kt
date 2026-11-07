package ru.multibrowser

import android.content.Context
import android.graphics.Rect
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ChromeViewportTest {
    @Test fun hidingAndRestoringBarsPreservesViewportAndReadingPosition() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        val root = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val top = View(ctx)
        val bottom = View(ctx)
        val page = ScrollView(ctx).apply {
            addView(TextView(ctx).apply { text = (1..200).joinToString("\n") { "Paragraph $it" }; textSize = 20f })
        }
        root.addView(top, LinearLayout.LayoutParams(720, 180))
        root.addView(page, LinearLayout.LayoutParams(720, 0, 1f))
        root.addView(bottom, LinearLayout.LayoutParams(720, 120))
        fun layout() {
            root.measure(View.MeasureSpec.makeMeasureSpec(720, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(1280, View.MeasureSpec.EXACTLY))
            root.layout(0, 0, 720, 1280)
        }
        fun bounds() = Rect(page.left, page.top, page.right, page.bottom)
        layout(); page.scrollTo(0, 450)
        val before = bounds(); val position = page.scrollY
        assertTrue(position > 0)
        repeat(3) {
            ChromeVisibility.autoHidden(listOf(top, bottom), true); layout()
            assertEquals(before, bounds())
            assertEquals(position, page.scrollY)
            assertFalse(top.isShown)
            ChromeVisibility.autoHidden(listOf(top, bottom), false); layout()
            assertEquals(before, bounds())
            assertEquals(position, page.scrollY)
            assertEquals(View.VISIBLE, top.visibility)
        }
    }
}
