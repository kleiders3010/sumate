// Sumate on Android: a Trusted Web Activity, i.e. the web app (signup.jurisgames.com) opened full screen
// in the phone's own Chrome. The app runs in Chrome; this app holds no code of its own.
plugins {
    id("com.android.application")
}

android {
    namespace = "com.jurisgames.sumate"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.jurisgames.sumate"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "1.0.2"
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
