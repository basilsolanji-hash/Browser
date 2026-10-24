package ru.multibrowser

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.PanZoomController

/**
 * GeckoView, который сообщает:
 *  - можно ли сейчас тянуть страницу вниз для обновления (страница или её внутренний блок
 *    уже в самом верху — важно для Claude и Gmail, где прокручивается не вся страница);
 *  - направление жеста пальцем, чтобы прятать и показывать панели браузера.
 */
class OsGeckoView(context: Context) : GeckoView(context) {

    /** true — содержимое под пальцем не может прокрутиться вверх, значит свайп вниз = обновление. */
    var canPullToRefresh = false
        private set

    /** Вызывается с true, когда палец ведёт вверх (листаем вниз), и с false — когда вниз. */
    var onScrollDirection: ((down: Boolean) -> Unit)? = null

    private val slop = ViewConfiguration.get(context).scaledTouchSlop * 3
    private var lastY = 0f
    private var travel = 0f

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastY = event.y
                travel = 0f
                canPullToRefresh = false
                // Событие отдаём движку один раз — через этот вызов, и узнаём, куда может прокрутиться содержимое.
                onTouchEventForDetailResult(event).accept { detail ->
                    if (detail != null) {
                        val canScrollUp = detail.scrollableDirections() and PanZoomController.SCROLLABLE_FLAG_TOP != 0
                        val overscroll = detail.overscrollDirections() and PanZoomController.OVERSCROLL_FLAG_VERTICAL != 0
                        canPullToRefresh = !canScrollUp && overscroll
                    }
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = event.y - lastY
                lastY = event.y
                // Сбрасываем накопленный путь при смене направления.
                travel = if ((travel > 0) == (dy > 0)) travel + dy else dy
                if (travel < -slop) { onScrollDirection?.invoke(true); travel = 0f }
                if (travel > slop) { onScrollDirection?.invoke(false); travel = 0f }
            }
        }
        return super.onTouchEvent(event)
    }
}
