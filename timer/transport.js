/* One UI, three ways of reaching a session.

   http  — the classic setup: the page talks to a Gracie Barra Timer server over
           /api/*. Same origin on a phone, or a LAN address in companion mode.
   local — the TV is the timer: calls land on an in-page engine with no network at
           all, so the Samsung app keeps running when the Wi-Fi drops.

   Both expose the same four calls and the same state shape, so app.js never has to
   know which one it is holding. */
(function (root) {
  'use strict';

  /* options.pin      — a pairing code to present on every call, for shells whose
                          cookie jar does not survive talking to another machine.
     options.onPaired — told the code that worked, so a shell can remember it. */
  function httpTransport(base, options) {
    var prefix = (base || '').replace(/\/+$/, '');
    var settings = options || {};
    var pin = settings.pin || null;

    function headers(extra) {
      var all = extra || {};
      /* The same secret the code pairs with, carried in a header rather than the
         body so a server that has never heard of it simply ignores it. */
      if (pin) all['X-Timer-Pin'] = pin;
      return all;
    }

    async function send(path, body) {
      var response = await fetch(prefix + path, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'include'
      });
      var payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Request failed');
      return payload;
    }

    return {
      kind: 'http',
      base: prefix,
      remote: !!prefix,
      state: async function () {
        var response = await fetch(prefix + '/api/state', {
          cache: 'no-store',
          credentials: 'include',
          headers: headers()
        });
        if (!response.ok) throw new Error('Connection lost');
        return response.json();
      },
      action: function (name) { return send('/api/action', { action: name }); },
      config: function (config) { return send('/api/config', config); },
      pair: async function (code) {
        var result = await send('/api/pair', { pin: code });
        pin = code;
        if (settings.onPaired) settings.onPaired(code);
        return result;
      }
    };
  }

  /* store is optional: anything with getItem/setItem keeps the gym's settings
     across restarts the way settings.json does next to the Windows executable. */
  function localTransport(engine, store, key) {
    var storeKey = key || 'gb-timer-config';

    if (store) {
      try {
        var saved = store.getItem(storeKey);
        if (saved) engine.setConfig(JSON.parse(saved));
      } catch (_) { /* a corrupt entry just means factory settings */ }
    }

    function persist() {
      if (!store) return;
      try { store.setItem(storeKey, JSON.stringify(engine.config)); } catch (_) {}
    }

    return {
      kind: 'local',
      base: '',
      remote: false,
      engine: engine,
      state: async function () {
        var state = engine.state();
        state.paired = true;
        state.pair_pin = null;
        state.local_url = null;
        state.local_urls = [];
        return state;
      },
      action: async function (name) {
        if (!engine.action(name)) throw new Error('Unknown action');
        return { ok: true };
      },
      config: async function (config) {
        if (!engine.setConfig(config)) throw new Error('Invalid settings');
        persist();
        return { ok: true };
      },
      pair: async function () { return { ok: true }; }
    };
  }

  root.GBTransport = { http: httpTransport, local: localTransport };
})(typeof globalThis !== 'undefined' ? globalThis : this);
