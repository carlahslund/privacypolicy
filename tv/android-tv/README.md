# Gracie Barra Round Timer — Android TV

A complete replacement for the Windows setup: the TV keeps the session, serves the
phone controller on the gym Wi-Fi and sounds the buzzer through the TV speakers. No
laptop, no HDMI cable, nothing to plug in before class.

## Installing it on the TV

1. Get `app-release.apk` — from the **TV apps** workflow run, or build it:
   ```bash
   cd tv/android-tv && ./gradlew assembleRelease
   ```
2. On the TV: **Settings → System → About** and press **Build** seven times to turn on
   developer options, then **Settings → System → Developer options → USB debugging**
   (or **Install unknown apps** if you are sideloading from a file manager).
3. Install it, whichever way suits the TV:
   ```bash
   adb connect <tv-ip>:5555
   adb install -r app-release.apk
   ```
   or copy the APK to a USB stick and open it with the TV's file manager, or use
   *Downloader* / *Send files to TV*.
4. Open **Gracie Barra Timer** from the home row and press **OK** to start a round.

The release APK is signed with the standard debug key so it installs straight away.
Publishing to Play instead means replacing `signingConfig` in
[`app/build.gradle.kts`](app/build.gradle.kts) with the gym's own upload key.

## Controlling it from a phone

Open the menu (**▲**), go to **PHONE CONTROL**, and scan the code on the screen — the
phone opens the same controller the laptop used to serve, and pairs itself. To type the
address instead, it is shown under the QR code along with the six-digit access code.

Phones must be on the same Wi-Fi as the TV. Guest networks that isolate clients from
each other will not work; that is the network, not the app.

## What it targets

`compileSdk`/`targetSdk` 35, `minSdk` 23 — comfortably inside Google Play's Android TV
requirement (API 34 for new apps and updates from 31 August 2026) and correct on the
2026 sets running Android 15 and 16. Raise both to 36 in
[`app/build.gradle.kts`](app/build.gradle.kts) when you next touch it; nothing in the
app depends on a behaviour that changed.

The manifest declares `leanback` as required and `touchscreen` as not, so the Play
listing is TV-only, and carries both `LEANBACK_LAUNCHER` and `LAUNCHER` so it is still
reachable on boxes that ship a phone-style launcher.

## Notes for whoever maintains it

- The display is a `WebView` over `http://127.0.0.1:8765/display`, so the wall shows
  the same page the Windows build served. The activity — not the WebView — handles the
  D-pad, because an activity sees the remote first; keys arrive in the page through
  `window.GBTvKey(...)`.
- The buzzer is synthesised natively ([`Buzzer.kt`](app/src/main/kotlin/com/graciebarra/roundtimer/tv/Buzzer.kt))
  and the page is told not to play its own, which is why there is no ENABLE SOUND step.
- Requests from loopback are trusted without a code — that is the TV's own screen.
  Everything arriving over the network pairs with the six digits first.
- The server takes the first free port from 8765 upwards, so a second copy of the app
  will not silently fail.
- Settings are kept in `SharedPreferences`, the way `settings.json` sat next to the
  executable.
- `./gradlew test` runs the session-engine and payload tests on the JVM; they need no
  device.
