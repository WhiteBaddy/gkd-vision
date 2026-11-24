plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.everything.vision.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.everything.vision"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "0.2.0-beta"
    }

    signingConfigs {
        create("dev") {
            storeFile = rootProject.file("keystore/vision-debug.p12")
            storePassword = "visiondebug"
            keyAlias = "vision"
            keyPassword = "visiondebug"
            storeType = "PKCS12"
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("dev")
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("dev")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":driver-core"))
}
