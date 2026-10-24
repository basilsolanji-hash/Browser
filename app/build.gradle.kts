plugins {
    id("com.android.application")
}

android {
    namespace = "ru.multibrowser"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.multibrowser"
        minSdk = 26
        targetSdk = 35
        versionCode = 7
        versionName = "0.7"
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    // Один и тот же ключ для всех сборок — новые APK ставятся поверх старых без потери входов.
    signingConfigs {
        create("shared") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Всегда самый свежий стабильный движок Firefox на момент сборки.
    implementation("org.mozilla.geckoview:geckoview:latest.release")
}
