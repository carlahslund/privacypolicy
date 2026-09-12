/* Decides, before app.js runs, where this page gets its session from.

   A phone or the gym laptop lands here with no shell set and talks to the server it
   was served by — exactly as the Windows build always worked. The Samsung shell has
   already installed its own GB_SHELL by this point and is left alone. */
(function (root) {
  'use strict';

  var params = new URLSearchParams(location.search);

  if (!root.GB_SHELL) {
    var kind = params.get('shell') || 'web';
    root.GB_SHELL = {
      kind: kind,
      nativeAudio: kind === 'android',
      transport: root.GBTransport.http(''),
      version: params.get('version') || '1.2.2',
      label: kind === 'android' ? 'Android TV' : 'Browser',
      blurb: kind === 'android'
        ? 'This TV runs the timer and the phone controller. No laptop needed.'
        : 'Served by the Gracie Barra Timer on this network.'
    };
  }

  var shell = root.GB_SHELL;
  if (shell.kind === 'android' || shell.kind === 'tizen') {
    document.body.classList.add('tv-shell');
    /* A few sets still overscan. Give the layout a margin it can lose safely. */
    var safe = params.get('safe');
    document.documentElement.style.setProperty('--tv-safe', (safe == null ? shell.safe == null ? 0 : shell.safe : Number(safe)) + 'px');
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
