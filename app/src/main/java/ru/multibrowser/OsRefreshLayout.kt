package ru.multibrowser

import android.content.Context
import android.view.MotionEvent
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * SwipeRefreshLayout, который на ACTION_DOWN всегда даёт родителю записать начало жеста.
 * Иначе callback возвращал бы устаревшее значение canPullToRefresh от прошлого касания,
 * и первый свайп после загрузки страницы терялся бы (или срабатывал ложно).
 */
class OsRefreshLayout(context: Context) : SwipeRefreshLayout(context) {
    private var inDown = false

    /** Может ли содержимое ещё прокрутиться вверх — тогда это не pull-to-refresh. */
    var canScrollContentUp: () -> Boolean = { true }

    init {
        setOnChildScrollUpCallback { _, _ -> if (inDown) false else canScrollContentUp() }
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        inDown = ev.actionMasked == MotionEvent.ACTION_DOWN
        return try {
            super.onInterceptTouchEvent(ev)
        } finally {
            inDown = false
        }
    }
}
