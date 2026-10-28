plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.newlife.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.newlife.mobile"
        minSdk = 26
        targetSdk = 34
        // رقم الإصدار يزيد تلقائياً مع كل بناء على GitHub (يستخدمه التحديث التلقائي داخل التطبيق)
        val run = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 0
        versionCode = 100 + run
        versionName = "1.0.$run"
        resValue("string", "update_repo", System.getenv("GITHUB_REPOSITORY") ?: "abds7443/NEW-LIFE")
        // معالجات الهواتف الحديثة فقط (يصغّر حجم APK)
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    signingConfigs {
        create("release") {
            storeFile = file("newlife.jks")
            storePassword = "newlife2026"
            keyAlias = "newlife"
            keyPassword = "newlife2026"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    packaging {
        resources {
            excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/*.kotlin_module")
        }
    }
    androidResources {
        noCompress += listOf("traineddata")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")

    // الكاميرا (مسح الباركود المباشر)
    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")

    // ML Kit — يعمل على الهاتف مجاناً وبدون حساب
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:translate:17.0.3")
    implementation("com.google.mlkit:language-id:17.0.6")
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0-beta1")

    // التعرف على النص العربي دون إنترنت
    implementation("cz.adaptech.tesseract4android:tesseract4android:4.9.0")

    // تشفير ملفات PDF وفك تشفيرها
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
}
