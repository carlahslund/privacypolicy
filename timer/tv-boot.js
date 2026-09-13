/* Wires the ten-foot menu to whatever the shell calls a key press.

   Android sends key names straight in through GBTvKey() from the activity, because
   an activity sees the D-pad before the WebView does. Tizen fires ordinary keydown
   events carrying TV key codes, so those are translated here. */
(function (root) {
  'use strict';

  var shell = root.GB_SHELL || {};
  if (shell.tv !== true) return;

  var menu = root.GBTvMenu.install(root.GBApp);

  /* Samsung remote key codes, plus the ones a browser or an Android WebView sends. */
  var CODES = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok',
    10009: 'back', 8: 'back', 27: 'back',
    415: 'play', 19: 'play', 10252: 'play', 179: 'play',
    417: 'next', 418: 'next', 428: 'next', 176: 'next',
    412: 'previous', 419: 'previous', 427: 'previous', 177: 'previous',
    403: 'buzzer', 457: 'menu', 18: 'menu'
  };
  var KEYS = {
    ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down',
    Enter: 'ok', ' ': 'play', Escape: 'back', Backspace: 'back',
    MediaPlayPause: 'play', MediaPlay: 'play', MediaPause: 'play',
    MediaTrackNext: 'next', MediaTrackPrevious: 'previous',
    ChannelUp: 'next', ChannelDown: 'previous',
    ColorF0Red: 'buzzer', ContextMenu: 'menu', Info: 'menu',
    b: 'buzzer', m: 'menu'
  };

  root.GBTvKey = function (name) { return menu.handleKey(name); };

  document.addEventListener('keydown', function (event) {
    var name = KEYS[event.key] || CODES[event.keyCode];
    if (!name) return;
    if (menu.handleKey(name)) event.preventDefault();
    else if (name === 'back' && shell.exit) shell.exit();
  });

  if (shell.ready) shell.ready(menu);
})(typeof globalThis !== 'undefined' ? globalThis : this);
