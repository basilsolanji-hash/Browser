package ru.multibrowser

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Settings.applyTheme(this)
    }
}
