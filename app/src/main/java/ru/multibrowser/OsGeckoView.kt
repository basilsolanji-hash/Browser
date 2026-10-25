package ru.multibrowser

import android.annotation.SuppressLint
import android.content.Context
import android.view.MotionEvent
import android.view.ViewConfiguration
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.PanZoomController

/**
 * GeckoView, который сообщает:
 *  - можно ли сейчас тянуть страницу вниз для обновления (содержимое под пальцем уже в самом
 *    верху и само прокрутку не обрабатывает — важно для Claude/Gmail, где скроллится не вся страница);
 *  - что содержимое реально прокрутилось вверх (чтобы прятать панели только тогда).
 */
class OsGeckoView(context: Context) : GeckoView(context) {

    /** true — свайп вниз у верха страницы = обновление (а не прокрутка внутреннего блока). */
    var canPullToRefresh = false
        private set

    /** Палец ведёт вверх (листаем вниз по странице) — панели прячем. */
    var onContentScrolledUp: (() -> Unit)? = null

    /** Палец ведёт вниз (листаем к началу) — панели возвращаем. */
    var onContentScrolledDown: (() -> Unit)? = null

    private val slop = ViewConfiguration.get(context).scaledTouchSlop * 3
    // rawY, а не event.y: при скрытии/показе панелей сам GeckoView сдвигается, и event.y «прыгает».
    private var lastRawY = 0f
    private var travel = 0f

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                Gecko.lastUserTouch = android.os.SystemClock.elapsedRealtime()
                lastRawY = event.rawY
                travel = 0f
                canPullToRefresh = false
                // Событие отдаём движку один раз — через этот вызов, и узнаём состояние прокрутки.
                onTouchEventForDetailResult(event).accept { detail ->
                    if (detail != null) {
                        val canScrollUp = detail.scrollableDirections() and PanZoomController.SCROLLABLE_FLAG_TOP != 0
                        val overscroll = detail.overscrollDirections() and PanZoomController.OVERSCROLL_FLAG_VERTICAL != 0
                        // Тянуть для обновления можно, только если прокрутку ведёт браузер, а не JS страницы
                        // (иначе потянутый composer Claude перезагрузил бы страницу и стёр набранный текст).
                        val byBrowser = detail.handledResult() == PanZoomController.INPUT_RESULT_HANDLED
                        canPullToRefresh = byBrowser && !canScrollUp && overscroll
                    }
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = event.rawY - lastRawY
                lastRawY = event.rawY
                travel = if ((travel > 0) == (dy > 0)) travel + dy else dy
                // Прячем панели, когда палец ведёт вверх и содержимое ещё может прокрутиться вверх.
                if (travel < -slop && !canPullToRefresh) {
                    onContentScrolledUp?.invoke()
                    travel = 0f
                }
                // Возвращаем панели, когда палец уверенно ведёт вниз.
                if (travel > slop) {
                    onContentScrolledDown?.invoke()
                    travel = 0f
                }
            }
        }
        return super.onTouchEvent(event)
    }
}
