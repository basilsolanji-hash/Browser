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
        // Номер сборки GitHub Actions: каждая сборка новее предыдущей.
        val build = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionCode = build
        versionName = "0.8.$build"
        ndk { abiFilters += listOf("arm64-v8a") }
    }

    // Подпись: личный ключ (расшифровывается в CI паролем из секрета KEYSTORE_PASSWORD),
    // а без него — общий тестовый ключ из репозитория, чтобы сборка всё равно работала.
    val releaseKeystore = System.getenv("OS_KEYSTORE")
    signingConfigs {
        create("shared") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        if (releaseKeystore != null) {
            create("private") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("OS_KEYSTORE_PASSWORD")
                keyAlias = "os"
                keyPassword = System.getenv("OS_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        // Debug — для приёмочных тестов на эмуляторе, поэтому ещё и x86_64.
        getByName("debug") {
            signingConfig = signingConfigs.getByName("shared")
            applicationIdSuffix = ".test"
            ndk { abiFilters += listOf("x86_64") }
        }
        // Release: без отладки — данные приложения (входы в аккаунты) нельзя вытащить через adb.
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("private") ?: signingConfigs.getByName("shared")
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
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    // Всегда самый свежий стабильный движок Firefox на момент сборки.
    implementation("org.mozilla.geckoview:geckoview:latest.release")
}
