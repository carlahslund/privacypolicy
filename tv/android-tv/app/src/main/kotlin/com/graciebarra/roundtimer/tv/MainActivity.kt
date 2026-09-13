package com.graciebarra.roundtimer.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * The whole app: a timer, a web server and a screen.
 *
 * The gym used to need a Windows laptop plugged into the TV to run a round. Here the TV
 * is the laptop — it keeps the session, serves the phone controller over the gym Wi-Fi
 * and sounds the buzzer itself. The display is the same page the laptop always served,
 * so what is on the wall looks exactly like what the gym is used to.
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "GracieBarraTimer"
        private const val PREFS = "gb-timer"
        private const val KEY_CONFIG = "config"
        private const val TICK_MS = 25L
        private const val EXIT_WINDOW_MS = 2500L
    }

    private lateinit var engine: TimerEngine
    private var server: TimerServer? = null
    private val buzzer by lazy { Buzzer(assets) }
    private var ticker: ScheduledExecutorService? = null
    private var webView: WebView? = null
    private var lastBackAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setBackgroundDrawableResource(android.R.color.black)

        engine = TimerEngine(loadConfig())
        engine.onEvent { event, config -> buzzer.play(event.kind, config.buzzer, config.volume) }

        val running = TimerServer(assets, engine) { config -> saveConfig(config) }
        val port = running.start()
        if (port == null) {
            showFailure(getString(R.string.error_port))
            return
        }
        server = running

        ticker = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "gb-timer-tick").apply { isDaemon = true }
        }.also {
            it.scheduleWithFixedDelay({ engine.tick() }, TICK_MS, TICK_MS, TimeUnit.MILLISECONDS)
        }

        try {
            showDisplay(port)
        } catch (error: Exception) {
            Log.e(TAG, "no usable WebView", error)
            showFailure(getString(R.string.error_webview))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showDisplay(port: Int) {
        val view = WebView(this)
        view.setBackgroundColor(Color.BLACK)
        view.isFocusable = true
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            textZoom = 100
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
        }
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                hideSystemBars()
            }
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        /* nativeaudio: the buzzer is played by Buzzer.kt, so the page must not double it.
           safe: a margin the layout can lose on a set that still overscans. */
        view.loadUrl("http://127.0.0.1:$port/display?shell=android&safe=12&version=${BuildConfig.VERSION_NAME}")
        setContentView(view)
        view.requestFocus()
        webView = view
    }

    private fun showFailure(message: String) {
        val text = TextView(this).apply {
            setBackgroundColor(Color.BLACK)
            setTextColor(Color.WHITE)
            textSize = 22f
            setPadding(64, 64, 64, 64)
            text = message
        }
        setContentView(text)
    }

    /** The activity sees the D-pad before the WebView does, so it does the routing. */
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = keyName(event.keyCode) ?: return super.dispatchKeyEvent(event)
        if (event.action != KeyEvent.ACTION_DOWN) return true
        if (name == "back") {
            onBackKey()
            return true
        }
        send(name)
        return true
    }

    private fun keyName(code: Int): String? = when (code) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A -> "ok"
        KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE, KeyEvent.KEYCODE_BUTTON_B -> "back"
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_SPACE -> "play"
        KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_CHANNEL_UP -> "next"
        KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_CHANNEL_DOWN -> "previous"
        KeyEvent.KEYCODE_PROG_RED -> "buzzer"
        KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_SETTINGS -> "menu"
        else -> null
    }

    private fun send(name: String, then: ((Boolean) -> Unit)? = null) {
        val view = webView
        if (view == null) {
            then?.invoke(false)
            return
        }
        view.evaluateJavascript("window.GBTvKey && window.GBTvKey('$name')") { result ->
            then?.invoke(result == "true")
        }
    }

    /** Back closes the menu; twice in a row with the menu shut leaves the app. */
    private fun onBackKey() {
        send("back") { handled ->
            if (handled) return@send
            val now = System.currentTimeMillis()
            if (now - lastBackAt < EXIT_WINDOW_MS) {
                finish()
            } else {
                lastBackAt = now
                Toast.makeText(this, R.string.exit_hint, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun hideSystemBars() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onDestroy() {
        ticker?.shutdownNow()
        server?.stop()
        buzzer.release()
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    /* --- the gym's settings outlive a reboot, the way settings.json did ----------- */

    private fun loadConfig(): TimerConfig {
        val saved = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CONFIG, null)
            ?: return TimerConfig()
        return try {
            val json = JSONObject(saved)
            TimerEngine.sanitise(
                preset = json.optString("preset", "positional"),
                round = json.optInt("round", 180),
                rest = json.optInt("rest", 30),
                rounds = json.optInt("rounds", 6),
                position = json.optString("position", ""),
                alternate = json.optBoolean("alternate", true),
                warning = json.optBoolean("warning", true),
                buzzer = json.optString("buzzer", "classic"),
                volume = json.optDouble("buzzer_volume", 0.8)
            ) ?: TimerConfig()
        } catch (_: Exception) {
            TimerConfig()
        }
    }

    private fun saveConfig(config: TimerConfig) {
        val json = JSONObject()
            .put("preset", config.preset)
            .put("round", config.round)
            .put("rest", config.rest)
            .put("rounds", config.rounds)
            .put("position", config.position)
            .put("alternate", config.alternate)
            .put("warning", config.warning)
            .put("buzzer", config.buzzer)
            .put("buzzer_volume", config.volume)
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_CONFIG, json.toString()).apply()
    }
}
