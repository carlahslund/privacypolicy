# Gracie Barra Round Timer — Samsung TV (Tizen)

The whole timer as a Tizen web app: the session runs on the TV and the remote drives
it. Works with no laptop, no network and no phone.

## Before you start: Samsung makes installing hard

Samsung does not allow sideloading the way Android TV does. Every app has to be signed
with a certificate tied to *your Samsung account and that particular TV*, and pushed
from Tizen Studio over the network with the TV in developer mode. There is no USB-stick
install. Budget 30–45 minutes on a laptop, once.

If that is more than the gym wants to take on, two shortcuts give the same timer on the
same screen:

1. **The TV's own browser — nothing to install.** Open the Samsung browser and go to
   the published address (once this branch is on `main`, that is
   `https://carlahslund.github.io/privacypolicy/timer/`). The whole timer runs there,
   engine and all, with the remote driving it exactly as the installed app does. You
   navigate to it each time instead of launching it from *Apps*, and the browser has to
   be left open — that is the only difference.
2. **An Android TV stick in the Samsung's HDMI port.** Any cheap stick takes the APK in
   about ten minutes, and that build also serves the phone controller, which the Tizen
   app cannot.

The rest of this page is the real install.

## Building the package

```bash
./build-wgt.sh                 # build/GracieBarraTimer.wgt, unsigned
./build-wgt.sh <profile>       # signed with a Tizen Studio security profile
```

The script copies the shared web layer next to `config.xml`, `icon.png` and
`tizen-shell.js`, and adds the two Tizen-only script tags to the page.

## Installing it on the TV

A retail Samsung TV only installs packages signed with a certificate issued by
Samsung, so this needs Tizen Studio once.

1. **Tizen Studio** (with the *TV Extensions* and the *Samsung Certificate Extension*)
   on a laptop on the same Wi-Fi as the TV.
2. **Developer mode on the TV**: open *Apps*, press **12345** on the remote, switch
   **Developer mode** on, enter the laptop's IP, then restart the TV. The 2026 sets add
   one extra confirmation prompt; the sequence is otherwise the same.
3. **A certificate profile**: Tizen Studio → *Tools → Certificate Manager* → new
   **Samsung** certificate. It asks for a Samsung account and for the TV's Device Unique
   ID, which Device Manager shows once the TV is connected.
4. **Sign and install**:
   ```bash
   ./build-wgt.sh <profile-name>
   tizen install -n build/GracieBarraTimer.wgt -t <device-name>
   ```
   Device Manager will also install a `.wgt` by drag and drop.

The app then appears in *Apps*. Developer-mode installs stay until the TV is factory
reset, but the TV has to be able to see the development laptop occasionally; if it
disappears after a few months, install it again.

## Using it

Press **OK** to start and pause, **◀ ▶** for ten seconds either way, **▲** for the
menu. The menu holds the quick controls, the full session setup and the timer source.

## Controlling it from a phone

A Tizen web app cannot open a listening socket, so this app cannot serve the phone
controller the way the Android TV app does. If the gym wants phone control:

1. Run the timer somewhere that can serve it — the Windows build on the gym laptop, or
   the Android TV app on a cheap TV box.
2. On the Samsung TV open the menu → **TIMER SOURCE** → *another timer on the Wi-Fi*,
   enter that machine's IPv4 address with the arrows, and press OK.
3. The TV then mirrors that session. To drive it from the remote as well, pair once
   under **CONNECT** with the six-digit code the timer shows.

The address and the code are remembered, so the TV comes back to the same timer after a
power cut. Switch back to **THIS TV (STANDALONE)** in the same panel.

## Notes for whoever maintains it

- `required_version` is 6.0, which covers Samsung sets from 2021 onwards including the
  2026 Tizen 10 line. Raise it only when you start using a newer TV API.
- Change the `id` on `<widget>` in [`config.xml`](config.xml) to a URI the gym owns
  before publishing anywhere; the `tizen:application` id must stay
  `<10-character package>.<name>`.
- Everything platform-specific is in [`tizen-shell.js`](tizen-shell.js): the session
  engine, the remote keys it claims, the screen-saver call, and the timer source. It
  installs `GB_SHELL` before `boot.js` looks for one; every Tizen API call is wrapped,
  so the same folder also runs in a desktop browser for testing.
- If the TV still blanks mid-class, turn the screen saver off in the TV's own settings
  — not every model honours the app's request.
