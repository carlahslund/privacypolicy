# The activity reaches into the WebView from Kotlin only, and the web layer calls
# nothing back through @JavascriptInterface, so the defaults are enough. Keep the
# engine's names readable in a crash report from a gym laptop.
-keepnames class com.graciebarra.roundtimer.tv.TimerEngine
-keepnames class com.graciebarra.roundtimer.tv.TimerServer
