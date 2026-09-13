# Gracie Barra Round Timer — television versions

Two installable TV builds of the gym timer that previously needed a Windows laptop,
and a browser version for the sets that will not let you install anything:

| | **Android TV** | **Samsung (Tizen)** | **Any TV browser** |
|---|---|---|---|
| Runs the session on the TV | yes | yes | yes |
| Driven by the TV remote | yes | yes | yes |
| Buzzer out of the TV speakers | yes, no "enable sound" tap | yes | yes |
| Serves the phone controller itself | **yes** — phones pair straight to the TV | no (Tizen apps cannot open a listening socket) | no |
| Phone control still possible | built in | by following a timer on a laptop or an Android TV box | same |
| Installed as an app | yes | yes | no — it is a web page |
| Getting it on screen | sideload an APK | Tizen Studio, developer mode, a Samsung certificate | type an address |
| Package | `.apk` | `.wgt` | [`/timer`](../timer) |

The third column exists because Samsung will not let you sideload: every Tizen app has
to be signed against your Samsung account *and* that particular TV. When that is more
setup than a gym wants, the browser build is the same timer with nothing to install.

The Windows build is unchanged and still works. A phone already paired with it keeps
working, because both TV apps speak the same `/api` routes.

> The old `README-EXE.txt` was right that a USB stick cannot make a TV run a Windows
> `.exe`. These are real TV applications instead — the timer, the web server and the
> buzzer rewritten for each platform.

## How it is put together

```
tv/
├── shared/web/          the display, the phone controller, the session engine,
│                        the buzzers and the ten-foot menu — one copy, used by
│                        every build and identical to what Windows served
│   └── buzzers/         the recorded bells
├── android-tv/          Kotlin shell: timer engine, HTTP server, native buzzer
├── samsung-tv/          Tizen shell: in-page engine, remote keys, packaging
├── windows/             the gym-laptop build, cross-compiled to a Windows exe
├── tools/               dev server, artwork and buzzer cutting
└── tests/               session engine and browser tests
```

The display on the wall is the same page the Windows build served, so the gym sees
exactly what it is used to. What differs is underneath:

- **Android TV** is a full replacement for the laptop. The Kotlin
  [`TimerEngine`](android-tv/app/src/main/kotlin/com/graciebarra/roundtimer/tv/TimerEngine.kt)
  keeps the session, [`TimerServer`](android-tv/app/src/main/kotlin/com/graciebarra/roundtimer/tv/TimerServer.kt)
  serves the controller on port 8765, and [`Buzzer`](android-tv/app/src/main/kotlin/com/graciebarra/roundtimer/tv/Buzzer.kt)
  synthesises the four horns in PCM so nobody has to press ENABLE SOUND first.
- **Samsung** runs the same state machine in JavaScript
  ([`timer-core.js`](shared/web/timer-core.js)) inside the page. Tizen web apps cannot
  listen on a socket, so this one cannot host the phone controller; under
  **TIMER SOURCE** it can instead follow a timer running on the gym laptop or on an
  Android TV box, which leaves phone control working as before.

The two engines are held to the same behaviour by the same scenarios, run twice:
[`tv/tests/timer-core.test.js`](tests/timer-core.test.js) and
[`TimerEngineTest.kt`](android-tv/app/src/test/kotlin/com/graciebarra/roundtimer/tv/TimerEngineTest.kt).

## Buzzers

Seven to choose from, everywhere: four synthesised in the page exactly as the
Windows build always did — classic gym horn, air horn, ringside bell, digital
chime — and three recordings the gym supplied:

| | |
|---|---|
| **Opening bell** | one struck bell, 1.1s |
| **Boxing bell** | a single ring, 0.8s |
| **Boxing bell ×3** | three rings, 1.2s — the usual end-of-round signal |

The recordings live in [`shared/web/buzzers`](shared/web/buzzers) and are exact
frame-level excerpts of the source files, cut by
[`tools/make-buzzers.py`](tools/make-buzzers.py) — no re-encoding, and the 33-second
source reduced to the ring that is actually wanted. The browser builds decode them
once and keep them warm so the bell lands on the second; Android plays them through
MediaPlayer instead, and falls back to the synthesised horn if one ever fails to
open. The ten-second warning and the end-of-rest chime stay synthesised whatever
buzzer is chosen, as before.

Re-cut them after changing a source recording:

```bash
python3 tv/tools/make-buzzers.py <folder holding the source mp3s>
```

## The gym laptop

[`windows/`](windows) is the laptop build, rebuilt. It serves the same pages, the
same `/api` routes and the same six-digit pairing as 1.2.2, keeps `settings.json`
next to the executable, and is a single file with nothing to install — now
including the recorded buzzers. Build it with `cd tv/windows && ./build.sh`, which
cross-compiles a Windows x64 executable from any machine; CI attaches one to every
run.

The 1.2.2 executable was shipped without its sources, so this is a rebuild against
the extracted assets and the behaviour the original's own pages depend on, not a
recompile of that C. The engine is held to the same test scenarios as the other two
([`windows/engine_test.go`](windows/engine_test.go)), which is what keeps the three
honest.

## Using the remote

| Key | With the menu closed | With the menu open |
|---|---|---|
| **OK** | start / pause | choose |
| **▲** | open the menu | move up, or change a digit |
| **▼** | open the menu | move down, or change a digit |
| **◀ ▶** | −10 / +10 seconds | change the value on this row |
| **⏭ ⏮ / CH▲ CH▼** | next / previous round | — |
| **BACK** | leave the app (twice on Android) | close the menu |
| **Red** | sound the buzzer | sound the buzzer |

The menu holds the quick controls, the whole session setup (format, round and rest
times, rounds, position, A/B roles, ten-second warning, buzzer and volume), the phone
pairing code, and — on Samsung — the timer source.

## Building

Both packages are built by CI on every push to `tv/`
([`.github/workflows/tv-apps.yml`](../.github/workflows/tv-apps.yml)) and attached to
the run, which is the easiest way to get them. To build locally:

```bash
# Windows laptop → build/GracieBarraTimer-v1.3.0.exe
cd tv/windows && ./build.sh

# Android TV → app/build/outputs/apk/release/app-release.apk
cd tv/android-tv && ./gradlew assembleRelease

# Samsung TV → build/GracieBarraTimer.wgt
cd tv/samsung-tv && ./build-wgt.sh

# Browser version → /timer at the repository root, served by GitHub Pages
tv/tools/build-web.sh
```

`/timer` is checked in because Pages serves the branch as it stands; CI fails if it
drifts from `tv/shared/web`, so rebuild and commit it when the shared layer changes.

Per-platform installation, including Samsung's developer mode and certificate, is in
[`android-tv/README.md`](android-tv/README.md) and [`samsung-tv/README.md`](samsung-tv/README.md).

## Working on it without a TV

```bash
node tv/tools/dev-server.js        # serves the shared web layer with the real API
node tv/tests/timer-core.test.js   # session engine
node tv/tests/browser.test.js      # pointer and D-pad interaction, in a real Chromium
(cd tv/windows && go test ./...)   # the same session scenarios again, in Go
```

The browser test needs Playwright once: `npm install --no-save playwright && npx
playwright install chromium`. It exists because a TV browser drives the page with a
pointer rather than a D-pad, and because a browser will not sound the buzzer until
something has been pressed — neither is visible from the engine tests.

- `http://localhost:8765/display?shell=android` — the Android TV screen, remote keys
  mapped to the keyboard arrows, Enter and Escape
- `http://localhost:8765/control` — the phone controller
- `tv/samsung-tv/build/package/index.html` — the Samsung app, served over any static
  server; the Tizen APIs are absent off-device and the app falls back to standalone

Regenerate the launcher artwork from the logo with `python3 tv/tools/make-art.py`.

## What the gym sees

Nothing about the session behaviour changed: the same presets (positional 3:00/0:30,
regular, competition, 8- and 10-minute, shark tank, open mat), the same red
ten-second warning, the same A/B role alternation, the same four buzzers, and the same
rule that applying settings restarts the session.
