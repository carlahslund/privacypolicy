GRACIE BARRA TIMER 1.3.0 - WINDOWS 64-BIT

No Python and no installation are needed.

1. Copy the .exe anywhere on the gym laptop. Delete older versions.
2. Double-click it. Keep the black timer window open while using the app.
3. Windows Firewall or Avast may ask about network access. Allow it on Private
   networks so the phone can connect.
4. The TV display opens in your default browser. Connect the laptop to the TV and
   press F for full screen.
5. Click ENABLE SOUND once on the TV display.
6. Open http://localhost:8765/control on the laptop. Scan the QR code in Settings
   with a phone on the same Wi-Fi.

BUZZERS
Seven to choose from in Settings: four synthesised (classic gym horn, air horn,
ringside bell, digital chime) and three recordings (opening bell, boxing bell,
boxing bell x3 - the usual three rings for the end of a round). Press PREVIEW to
hear the one you have selected.

IF THE PHONE CANNOT CONNECT
Add the .exe as an allowed app in Avast Firewall, or allow inbound TCP port 8765
on the Private network. Guest Wi-Fi often stops devices from seeing each other.

The app contains its web interface, logo, phone pairing QR, timer server and
buzzers. settings.json is created next to the executable when settings are saved.

RUNNING IT ON THE TV INSTEAD
This file is a Windows program; a USB stick cannot make a TV run it. There are now
TV versions that need no laptop at all - an Android TV app, a Samsung app, and a
browser version any smart TV can open. See tv/README.md in the repository.
