plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.graciebarra.roundtimer.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.graciebarra.roundtimer.tv"
        minSdk = 23
        targetSdk = 35
        versionCode = 10202
        versionName = "1.2.2"
        resourceConfigurations += listOf("en")
    }

    /* The display, the phone controller and the buzzer voices all live in the shared
       web layer, which both TV apps and the Windows build are cut from. Pointing the
       asset directory at it keeps one copy of that UI in the repository. */
    sourceSets {
        getByName("main") {
            assets.srcDir("../../shared")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    androidResources {
        /* The recorded buzzers are opened with openFd, which only works on an asset
           that was stored rather than deflated. aapt already leaves mp3 alone; this
           says so out loud in case that default ever changes. */
        noCompress += "mp3"
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    lint {
        abortOnError = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    testImplementation(libs.junit)
}
