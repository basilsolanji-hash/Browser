package ru.multibrowser

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Tr.apply(this)
        Home.init(this)
        Settings.applyTheme(this)
        AppLock.register(this)
    }
}
