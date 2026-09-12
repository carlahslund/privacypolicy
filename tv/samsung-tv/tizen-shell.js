/* Samsung TV shell.

   A Tizen web app cannot open a listening socket, so unlike the Android build this TV
   cannot serve the phone controller itself. It does the next best two things: it runs
   the whole session on its own, driven by the remote, and — when the gym already has a
   timer running on a laptop or an Android TV — it can follow that one instead, leaving
   the phone controller working as it always did.

   Loaded before boot.js, which then leaves GB_SHELL alone. */
(function (root) {
  'use strict';

  var SOURCE_KEY = 'gb-timer-source';
  var PIN_KEY = 'gb-timer-pin';
  var VERSION = '1.2.2';

  var store = (function () {
    try {
      root.localStorage.setItem('gb-probe', '1');
      root.localStorage.removeItem('gb-probe');
      return root.localStorage;
    } catch (_) {
      return null;   /* a TV with storage disabled still runs, it just forgets */
    }
  })();

  function remember(key, value) {
    if (!store) return;
    try {
      if (value) store.setItem(key, value);
      else store.removeItem(key);
    } catch (_) {}
  }
  function recall(key) {
    if (!store) return '';
    try { return store.getItem(key) || ''; } catch (_) { return ''; }
  }

  var engine = new root.GBTimer.TimerEngine({});
  var standalone = root.GBTransport.local(engine, store);
  var source = recall(SOURCE_KEY);

  function remote(base) {
    return root.GBTransport.http(base, {
      pin: recall(PIN_KEY),
      onPaired: function (pin) { remember(PIN_KEY, pin); }
    });
  }

  var shell = {
    kind: 'tizen',
    nativeAudio: false,
    sources: true,
    version: VERSION,
    label: 'Samsung TV',
    safe: 24,               /* a margin for sets that still overscan */
    blurb: 'This TV keeps the session. To control it from a phone, point it at a ' +
      'timer running on the gym laptop or an Android TV box under TIMER SOURCE.',
    transport: source ? remote(source) : standalone,
    source: function () { return source; },
    setSource: function (next) {
      source = next || '';
      remember(SOURCE_KEY, source);
      if (!source) remember(PIN_KEY, '');
      shell.transport = source ? remote(source) : standalone;
      return true;
    },
    exit: function () {
      try { root.tizen.application.getCurrentApplication().exit(); } catch (_) {}
    },
    ready: function () { keepAwake(); }
  };

  root.GB_SHELL = shell;

  /* The engine only advances while something asks it to; the display polls every
     350ms but a buzzer has to land on the second. */
  setInterval(function () { engine.tick(); }, 50);

  /* Arrows, OK and RETURN always arrive. The rest have to be asked for by name, and
     a set that does not have one simply throws, which is not worth failing over. */
  (function registerKeys() {
    var wanted = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaFastForward',
      'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious',
      'ChannelUp', 'ChannelDown', 'ColorF0Red', 'Info'];
    try {
      if (!root.tizen || !root.tizen.tvinputdevice) return;
      var supported = {};
      try {
        root.tizen.tvinputdevice.getSupportedKeys().forEach(function (key) { supported[key.name] = true; });
      } catch (_) {
        supported = null;   /* older sets: just try them all */
      }
      wanted.forEach(function (name) {
        if (supported && !supported[name]) return;
        try { root.tizen.tvinputdevice.registerKey(name); } catch (_) {}
      });
    } catch (_) {}
  })();

  /* A round timer that lets the screen saver cut in mid-round is no use. */
  function keepAwake() {
    try {
      if (root.webapis && root.webapis.appcommon) {
        root.webapis.appcommon.setScreenSaver(
          root.webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF,
          function () {},
          function () {}
        );
      }
    } catch (_) {
      /* Not every model exposes it. The TV's own screen-saver setting still applies. */
    }
  }
})(window);
