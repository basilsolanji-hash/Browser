plugins {
    id("com.android.application") version "9.1.0" apply false
    // AGP 9 компилирует Kotlin сам; здесь только задаём свежую версию компилятора,
    // чтобы читать библиотеки, собранные на Kotlin 2.4 (их тянет новый GeckoView).
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
}
