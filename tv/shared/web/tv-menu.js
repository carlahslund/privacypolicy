/* The ten-foot layer.

   A phone controller assumes a finger; a TV gives you four arrows and OK, from three
   metres away. This builds a menu for that: quick controls, the whole session setup,
   and — when the TV is also the server — the phone pairing panel. Both TV shells feed
   it key names and it answers whether it used them. */
(function (root) {
  'use strict';

  var PRESETS = { positional: [180, 30], regular: [300, 60], competition: [360, 60], eight: [480, 60], ten: [600, 60], shark: [120, 15], open: [0, 0] };
  var PRESET_ORDER = ['positional', 'regular', 'competition', 'eight', 'ten', 'shark', 'open', 'custom'];
  var PRESET_LABELS = { positional: 'POSITIONAL 3:00/0:30', regular: 'REGULAR 5:00/1:00', competition: 'COMPETITION 6:00/1:00', eight: '8-MINUTE', ten: '10-MINUTE', shark: 'SHARK TANK 2:00/0:15', open: 'OPEN MAT (STOPWATCH)', custom: 'CUSTOM' };
  var POSITIONS = ['', 'Closed Guard', 'Open Guard', 'Half Guard', 'Side Control', 'Mount', 'Back Control', 'Takedowns', 'Passing', 'Escapes'];
  var BUZZERS = ['classic', 'airhorn', 'bell', 'digital', 'opening', 'boxing', 'boxing3'];
  var BUZZER_LABELS = {
    classic: 'CLASSIC GYM HORN', airhorn: 'AIR HORN', bell: 'RINGSIDE BELL', digital: 'DIGITAL CHIME',
    opening: 'OPENING BELL (RECORDED)', boxing: 'BOXING BELL (RECORDED)', boxing3: 'BOXING BELL ×3 (RECORDED)'
  };

  var QUICK = [
    { action: 'toggle', label: '▶ START / PAUSE' },
    { action: 'buzzer', label: '◖)) BUZZER' },
    { action: 'previous', label: '↶ PREVIOUS' },
    { action: 'next', label: 'NEXT ↷' },
    { action: 'minus', label: '− 10 SEC' },
    { action: 'plus', label: '+ 10 SEC' },
    { action: 'reset', label: '↺ RESET SESSION' }
  ];

  var MARKUP =
    '<div class="tv-sheet">' +
    '  <div class="tv-tabs" id="tv-tabs"></div>' +
    '  <div class="tv-pane" id="tv-pane"></div>' +
    '  <div class="tv-hint" id="tv-foot"></div>' +
    '</div>';

  function mmss(n) {
    n = Math.max(0, Math.floor(n));
    return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* Element.closest is missing on a few older TV browsers, and this file has to
     run on whatever the set happens to ship. */
  function ancestor(node, attribute) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute(attribute) !== null) return node;
      node = node.parentNode;
    }
    return null;
  }
  function cycle(list, value, step) {
    var i = list.indexOf(value);
    if (i < 0) i = 0;
    return list[(i + step + list.length) % list.length];
  }

  function TvMenu(app) {
    this.app = app;
    this.open = false;
    this.tab = 0;
    this.index = 0;
    this.onTabs = false;
    this.draft = null;
    this.dirty = false;
    this.entry = null;
    this.sourceRemote = null;   /* null: follow whatever the shell is actually using */
    this.state = null;
    this.toastTimer = 0;
    this._build();
    var self = this;
    app.onState(function (state) { self._onState(state); });
  }

  TvMenu.prototype._build = function () {
    var root_ = document.createElement('div');
    root_.className = 'tv-overlay';
    root_.id = 'tv-overlay';
    root_.hidden = true;
    root_.innerHTML = MARKUP;
    document.body.appendChild(root_);

    var toast = document.createElement('div');
    toast.className = 'tv-toast';
    toast.id = 'tv-toast';
    toast.hidden = true;
    document.body.appendChild(toast);

    var hint = document.createElement('div');
    hint.className = 'tv-idle-hint';
    hint.id = 'tv-idle-hint';
    hint.textContent = 'OK  START / PAUSE   ·   ▲  MENU   ·   ◀ ▶  ± 10 SEC';
    document.body.appendChild(hint);

    this.el = root_;
    this.tabsEl = document.getElementById('tv-tabs');
    this.paneEl = document.getElementById('tv-pane');
    this.footEl = document.getElementById('tv-foot');
    this.toastEl = toast;
    this.hintEl = hint;

    if (this.app.shell.pointer) {
      hint.textContent = 'Aim at CONTROLS, or press OK on the remote';
    }

    /* Everything the D-pad can do, a pointer can do too: a TV browser may never
       send this page a key event, and then clicking is all there is. Delegated,
       because the panel is rebuilt from scratch on every render. */
    var self = this;

    this.tabsEl.addEventListener('click', function (event) {
      var tab = ancestor(event.target, 'data-tab');
      if (!tab) return;
      self.tab = Number(tab.getAttribute('data-tab'));
      self.onTabs = false;
      self.index = 0;
      self._render();
    });

    this.paneEl.addEventListener('click', function (event) {
      var row = ancestor(event.target, 'data-index');
      if (!row) return;
      self.onTabs = false;
      self.index = Number(row.getAttribute('data-index'));

      var digit = ancestor(event.target, 'data-digit');
      if (digit) {
        var descriptor = self._rows()[self.index];
        var entry = self._entryFor(descriptor.entry);
        var at = Number(digit.getAttribute('data-digit'));
        /* First aim picks the digit, a second one counts it up. */
        if (entry.at === at) entry.digits[at] = (entry.digits[at] + 1) % 10;
        else entry.at = at;
        self._render();
        return;
      }

      var step = ancestor(event.target, 'data-step');
      if (step) {
        self._adjust(Number(step.getAttribute('data-step')));
        return;
      }

      self._activate();
    });

    /* Aiming past the panel closes it, the way tapping outside a dialog does. */
    root_.addEventListener('click', function (event) {
      if (event.target === root_) self.close();
    });
  };

  TvMenu.prototype._onState = function (state) {
    this.state = state;
    if (state && !this.dirty) this.draft = Object.assign({}, state.config);
    if (this.open) this._render();
    if (state && this.hintEl) this.hintEl.hidden = state.running;
  };

  /* Which panes exist depends on what this TV can actually do right now. */
  TvMenu.prototype._tabs = function () {
    var tabs = [{ key: 'controls', label: 'CONTROLS' }];
    var paired = !this.state || this.state.paired !== false;
    /* Until this remote is paired there is nothing it can change, so put the way to
       fix that first and leave the rest out. */
    if (!paired) tabs.push({ key: 'connect', label: 'CONNECT' });
    if (paired) tabs.push({ key: 'setup', label: 'SESSION SETUP' });
    if (this.state && this.state.local_urls && this.state.local_urls.length) tabs.push({ key: 'phone', label: 'PHONE CONTROL' });
    if (this.app.shell.sources) tabs.push({ key: 'source', label: 'TIMER SOURCE' });
    tabs.push({ key: 'about', label: 'ABOUT' });
    return tabs;
  };

  TvMenu.prototype._setupRows = function () {
    var d = this.draft || {};
    var isOpen = d.preset === 'open';
    var self = this;
    var rows = [
      {
        label: 'FORMAT', value: PRESET_LABELS[d.preset] || 'CUSTOM',
        adjust: function (step) {
          d.preset = cycle(PRESET_ORDER, d.preset, step);
          if (PRESETS[d.preset]) { d.round = PRESETS[d.preset][0]; d.rest = PRESETS[d.preset][1]; }
          if (d.preset === 'open') { d.rounds = 1; d.position = ''; }
          else if (!d.rounds || d.rounds < 1) d.rounds = 6;
        }
      },
      {
        label: 'ROUND TIME', value: isOpen ? '—' : mmss(d.round), disabled: isOpen,
        adjust: function (step) { d.round = clamp(d.round + step * 15, 15, 3599); self._loosenPreset(); }
      },
      {
        label: 'REST TIME', value: isOpen ? '—' : mmss(d.rest), disabled: isOpen,
        adjust: function (step) { d.rest = clamp(d.rest + step * 5, 0, 600); self._loosenPreset(); }
      },
      {
        label: 'ROUNDS', value: isOpen ? '—' : String(d.rounds), disabled: isOpen,
        adjust: function (step) { d.rounds = clamp(d.rounds + step, 1, 99); self._loosenPreset(); }
      },
      {
        label: 'POSITION', value: d.position || 'FREE ROLL', disabled: isOpen,
        adjust: function (step) { d.position = cycle(POSITIONS, POSITIONS.indexOf(d.position) < 0 ? '' : d.position, step); }
      },
      {
        label: 'ALTERNATE A / B ROLES', value: d.alternate ? 'ON' : 'OFF', disabled: isOpen,
        adjust: function () { d.alternate = !d.alternate; }
      },
      {
        label: 'FINAL 10-SECOND WARNING', value: d.warning ? 'ON' : 'OFF', disabled: isOpen,
        adjust: function () { d.warning = !d.warning; }
      },
      {
        label: 'BUZZER  (OK TO PREVIEW)', value: BUZZER_LABELS[d.buzzer] || 'CLASSIC GYM HORN',
        adjust: function (step) { d.buzzer = cycle(BUZZERS, d.buzzer, step); },
        activate: function () { self._preview(); }
      },
      {
        label: 'BUZZER VOLUME', value: Math.round((d.buzzer_volume || 0.8) * 100) + '%',
        adjust: function (step) { d.buzzer_volume = clamp(Math.round((d.buzzer_volume * 100 + step * 10)) / 100, 0.1, 1); }
      },
      {
        label: 'APPLY & START', button: true,
        activate: function () { self._apply(); }
      }
    ];
    return rows;
  };

  /* Nudging a time off a named format makes it a custom one — the display should
     not keep announcing POSITIONAL SPARRING for 4:30 rounds. */
  TvMenu.prototype._loosenPreset = function () {
    var d = this.draft;
    var known = PRESETS[d.preset];
    if (known && (known[0] !== d.round || known[1] !== d.rest)) d.preset = 'custom';
  };

  TvMenu.prototype._preview = function () {
    var self = this;
    this.app.startAudio().then(function (ok) {
      if (!ok && !self.app.shell.nativeAudio) { self.notify('This TV will not play a preview here.'); return; }
      if (self.app.shell.previewBuzzer) {
        self.app.shell.previewBuzzer(self.draft.buzzer, self.draft.buzzer_volume);
        return;
      }
      /* A recorded bell has to be decoded before it can be previewed. */
      Promise.resolve(self.app.loadBuzzer(self.draft.buzzer)).then(function () {
        self.app.sound('manual', self.draft.buzzer, self.draft.buzzer_volume);
      });
    });
  };

  TvMenu.prototype._apply = function () {
    var self = this;
    this.app.applyConfig(this.draft).then(function () {
      self.dirty = false;
      return self.app.action('toggle');
    }).then(function () {
      self.close();
      self.notify('Session started.');
    }).catch(function (err) { self.notify(err.message); });
  };

  TvMenu.prototype._rows = function () {
    var tabs = this._tabs();
    var key = (tabs[this.tab] || tabs[0]).key;
    if (key === 'controls') return QUICK.map(function (item) { return { label: item.label, button: true, action: item.action }; });
    if (key === 'setup') return this._setupRows();
    if (key === 'connect') return [{ entry: 'pin' }];
    if (key === 'phone') return [{ qr: true }];
    if (key === 'source') return this._sourceRows();
    return [{ about: true }];
  };

  var ENTRIES = {
    pin: { length: 6, label: 'ACCESS CODE FROM THE TIMER SERVER' },
    address: { length: 12, label: 'TIMER IPv4 ADDRESS' }
  };

  /* One digit widget for both the pairing code and an IPv4 address: up and down
     change a digit, left and right walk them, OK steps on and finishes. Typing on a
     remote is unpleasant enough without a keyboard grid. */
  TvMenu.prototype._entryFor = function (kind) {
    if (this.entry && this.entry.kind === kind) return this.entry;
    var length = ENTRIES[kind].length;
    var digits = new Array(length);
    for (var i = 0; i < length; i++) digits[i] = 0;
    if (kind === 'address') {
      var current = (this.app.shell.source && this.app.shell.source()) || '';
      var found = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/.exec(current);
      if (found) {
        var text = '';
        for (var part = 1; part <= 4; part++) text += ('00' + found[part]).slice(-3);
        for (var d = 0; d < 12; d++) digits[d] = Number(text.charAt(d));
      }
    }
    this.entry = { kind: kind, digits: digits, at: 0 };
    return this.entry;
  };

  TvMenu.prototype._entryText = function (entry) {
    var text = entry.digits.join('');
    if (entry.kind !== 'address') return text;
    return [0, 3, 6, 9].map(function (start) { return Number(text.substr(start, 3)); }).join('.');
  };

  TvMenu.prototype._submitEntry = function (entry) {
    var self = this;
    if (entry.kind === 'pin') {
      this.app.pair(entry.digits.join('')).then(function () {
        self.notify('Paired. This remote now controls the timer.');
        self.entry = null;
        self.tab = 0;
        self.index = 0;
      }).catch(function (err) { self.notify(err.message); });
      return;
    }
    this._useSource(this._entryText(entry));
  };

  /* Until the coach touches the toggle it shows the truth, so a TV that came up
     following the laptop does not claim to be running the session itself. */
  TvMenu.prototype._wantsRemote = function () {
    if (this.sourceRemote !== null) return this.sourceRemote;
    return !!(this.app.shell.source && this.app.shell.source());
  };

  TvMenu.prototype._sourceRows = function () {
    var self = this;
    var active = (this.app.shell.source && this.app.shell.source()) || '';
    var wantsRemote = this._wantsRemote();
    var rows = [
      {
        label: 'NOW USING', value: active ? active : 'THIS TV', readonly: true
      },
      {
        label: 'TIMER SOURCE',
        value: wantsRemote ? 'ANOTHER TIMER ON THE WI-FI' : 'THIS TV (STANDALONE)',
        adjust: function () { self.sourceRemote = !self._wantsRemote(); }
      }
    ];
    if (wantsRemote) {
      rows.push({ entry: 'address' });
      rows.push({ label: 'USE THIS TIMER', button: true, activate: function () { self._useSource(self._entryText(self._entryFor('address'))); } });
    } else {
      rows.push({ label: 'RUN THE TIMER ON THIS TV', button: true, activate: function () { self._useSource(''); } });
    }
    return rows;
  };

  TvMenu.prototype._useSource = function (address) {
    var self = this;
    if (!this.app.shell.setSource) return;
    if (address) {
      var octets = address.split('.').map(Number);
      if (octets.length !== 4 || octets.some(function (n) { return !(n >= 0 && n <= 255); }) || octets[0] === 0) {
        this.notify('Enter the timer\u2019s IPv4 address, such as 192.168.1.42.');
        return;
      }
    }
    Promise.resolve(this.app.shell.setSource(address ? 'http://' + address + ':8765' : ''))
      .then(function () { return self.app.resync(); })
      .then(function () {
        self.entry = null;
        self.dirty = false;
        self.sourceRemote = null;
        self.index = 0;
        self.notify(address ? 'Now following the timer at ' + address + '.' : 'This TV is running the timer.');
        self._render();
      })
      .catch(function (err) { self.notify(err.message); });
  };

  TvMenu.prototype._render = function () {
    var tabs = this._tabs();
    if (this.tab >= tabs.length) this.tab = tabs.length - 1;
    var self = this;

    this.tabsEl.innerHTML = tabs.map(function (tab, i) {
      return '<span class="tv-tab' + (i === self.tab ? ' current' : '') + (self.onTabs && i === self.tab ? ' focused' : '') +
        '" data-tab="' + i + '">' + tab.label + '</span>';
    }).join('');

    var rows = this._rows();
    if (this.index >= rows.length) this.index = rows.length - 1;
    if (this.index < 0) this.index = 0;

    var html = rows.map(function (row, i) {
      var focused = !self.onTabs && i === self.index;
      if (row.about) return self._aboutHtml();
      if (row.qr) return self._qrHtml();
      if (row.entry) return self._entryHtml(self._entryFor(row.entry), focused, i);
      if (row.button) {
        return '<div class="tv-row tv-row-button' + (focused ? ' focused' : '') + '" data-index="' + i + '">' + row.label + '</div>';
      }
      /* The steppers stay drawn whether or not the row has focus: on a pointer TV
         they are the only way to change the value, so they cannot hide. */
      var arrows = !row.disabled && !row.readonly && !!row.adjust;
      return '<div class="tv-row' + (focused ? ' focused' : '') + (row.disabled || row.readonly ? ' disabled' : '') +
        '" data-index="' + i + '">' +
        '<span class="tv-row-label">' + row.label + '</span>' +
        '<span class="tv-row-value">' + (arrows ? '<i data-step="-1">◀</i>' : '') + row.value +
        (arrows ? '<i data-step="1">▶</i>' : '') + '</span>' +
        '</div>';
    }).join('');
    this.paneEl.innerHTML = html;

    var tabKey = (tabs[this.tab] || tabs[0]).key;
    this.footEl.textContent = this.onTabs
      ? '◀ ▶  CHOOSE A PANEL     ▼  ENTER IT     BACK  CLOSE'
      : tabKey === 'setup'
        ? '▲ ▼  MOVE     ◀ ▶  CHANGE     OK  APPLY     BACK  CLOSE' + (this.dirty ? '     ·  UNAPPLIED CHANGES' : '')
        : tabKey === 'connect' || tabKey === 'source'
          ? '▲ ▼  MOVE OR CHANGE A DIGIT     ◀ ▶  ACROSS     OK  SELECT     BACK  CLOSE'
          : '▲ ▼  MOVE     OK  SELECT     BACK  CLOSE';
  };

  TvMenu.prototype._qrHtml = function () {
    var state = this.state || {};
    var url = (state.local_urls || [])[0] || '';
    var pin = state.pair_pin || '';
    var payload = url && pin ? url + '?pair=' + pin : url;
    var img = payload && root.GBQr ? '<img class="tv-qr" alt="Scan to open the phone controller" src="' + root.GBQr.svg(payload) + '">' : '';
    return '<div class="tv-phone">' + img +
      '<div class="tv-phone-copy"><strong>SCAN TO CONTROL FROM A PHONE</strong>' +
      '<p>Point the phone camera at this code. The phone must be on the same Wi-Fi as this TV.</p>' +
      '<div class="tv-phone-url">' + (url || 'No network address yet — check the TV Wi-Fi.') + '</div>' +
      (pin ? '<div class="tv-phone-pin">ACCESS CODE <b>' + pin + '</b></div>' : '') +
      '<small>Other addresses: ' + ((state.local_urls || []).slice(1).join('  ·  ') || 'none') + '</small></div></div>';
  };

  TvMenu.prototype._entryHtml = function (entry, focused, index) {
    var digits = entry.digits.map(function (digit, i) {
      var gap = entry.kind === 'address' && i > 0 && i % 3 === 0 ? ' gap' : '';
      return '<span class="tv-digit' + gap + (focused && i === entry.at ? ' focused' : '') +
        '" data-digit="' + i + '">' + digit + '</span>';
    }).join('');
    return '<div class="tv-row tv-row-pin' + (focused ? ' focused' : '') + '" data-index="' + index + '">' +
      '<span class="tv-row-label">' + ENTRIES[entry.kind].label + '</span>' +
      '<span class="tv-pin">' + digits + '</span></div>';
  };

  TvMenu.prototype._aboutHtml = function () {
    var shell = this.app.shell || {};
    var state = this.state;
    return '<div class="tv-about">' +
      '<p><strong>Gracie Barra Round Timer</strong> · ' + (shell.version || '1.2.2') + ' · ' + (shell.label || 'TV') + '</p>' +
      '<p>' + (shell.blurb || '') + '</p>' +
      '<p class="tv-about-state">' + (state ? 'Session: ' + state.phase.toUpperCase() + ' · round ' + state.round_number + ' of ' + state.config.rounds : 'Waiting for the timer…') + '</p>' +
      '<p class="tv-about-keys">OK start/pause · ◀ ▶ ten seconds · ▲ menu · ⏭ ⏮ next and previous round · BACK close</p>' +
      '</div>';
  };

  TvMenu.prototype.notify = function (message) {
    if (!message) return;
    var self = this;
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(function () { self.toastEl.hidden = true; }, 4000);
  };

  TvMenu.prototype.show = function () {
    this.open = true;
    this.el.hidden = false;
    document.body.classList.add('tv-menu-open');
    this._render();
  };
  TvMenu.prototype.close = function () {
    this.open = false;
    this.el.hidden = true;
    document.body.classList.remove('tv-menu-open');
  };
  TvMenu.prototype.toggle = function () { this.open ? this.close() : this.show(); };
  TvMenu.prototype.isOpen = function () { return this.open; };

  TvMenu.prototype._bumpDigit = function (kind, step) {
    var entry = this._entryFor(kind);
    entry.digits[entry.at] = (entry.digits[entry.at] + step + 10) % 10;
    this._render();
  };

  TvMenu.prototype._move = function (step) {
    var rows = this._rows();
    var next = this.index + step;
    if (next < 0) { this.onTabs = true; this._render(); return; }
    this.index = clamp(next, 0, rows.length - 1);
    this._render();
  };

  TvMenu.prototype._adjust = function (step) {
    var rows = this._rows();
    var row = rows[this.index];
    if (!row) return;
    if (row.entry) {
      var entry = this._entryFor(row.entry);
      if (step < 0 && entry.at === 0) { this.onTabs = true; this._render(); return; }
      entry.at = clamp(entry.at + step, 0, entry.digits.length - 1);
      this._render();
      return;
    }
    if (!row.adjust || row.disabled || row.readonly) return;
    row.adjust(step);
    this.dirty = true;
    this._render();
  };

  TvMenu.prototype._activate = function () {
    var rows = this._rows();
    var row = rows[this.index];
    if (!row) return;
    if (row.entry) {
      var entry = this._entryFor(row.entry);
      if (entry.at < entry.digits.length - 1) { entry.at += 1; this._render(); }
      else this._submitEntry(entry);
      return;
    }
    if (row.action) { this.app.action(row.action); return; }
    if (row.activate) { row.activate(); return; }
    if (row.adjust && !row.disabled && !row.readonly) this._adjust(1);
  };

  /* The shells translate their platform key codes into these names. Returns true
     when the menu consumed the key, so the shell knows to stop there. */
  TvMenu.prototype.handleKey = function (key) {
    if (!this.open) {
      switch (key) {
        case 'up': case 'menu': this.show(); return true;
        case 'down': this.show(); return true;
        case 'ok': this.app.action('toggle'); return true;
        case 'play': this.app.action('toggle'); return true;
        case 'left': this.app.action('minus'); return true;
        case 'right': this.app.action('plus'); return true;
        case 'next': this.app.action('next'); return true;
        case 'previous': this.app.action('previous'); return true;
        case 'buzzer': this.app.action('buzzer'); return true;
        case 'back': return false;
        default: return false;
      }
    }

    var rows = this._rows();
    var row = rows[this.index];
    switch (key) {
      case 'back':
        this.close();
        return true;
      case 'up':
        if (this.onTabs) return true;
        if (row && row.entry) { this._bumpDigit(row.entry, 1); return true; }
        this._move(-1);
        return true;
      case 'down':
        if (this.onTabs) { this.onTabs = false; this.index = 0; this._render(); return true; }
        if (row && row.entry) { this._bumpDigit(row.entry, -1); return true; }
        this._move(1);
        return true;
      case 'left':
        if (this.onTabs) { this.tab = Math.max(0, this.tab - 1); this.index = 0; this._render(); return true; }
        this._adjust(-1);
        return true;
      case 'right':
        if (this.onTabs) { this.tab = Math.min(this._tabs().length - 1, this.tab + 1); this.index = 0; this._render(); return true; }
        this._adjust(1);
        return true;
      case 'ok':
        if (this.onTabs) { this.onTabs = false; this.index = 0; this._render(); return true; }
        this._activate();
        return true;
      case 'menu':
        this.onTabs = true;
        this._render();
        return true;
      case 'play':
        this.app.action('toggle');
        return true;
      case 'buzzer':
        this.app.action('buzzer');
        return true;
      default:
        return false;
    }
  };

  root.GBTvMenu = {
    install: function (app) {
      var menu = new TvMenu(app);
      root.GBTvMenu.handleKey = menu.handleKey.bind(menu);
      root.GBTvMenu.notify = menu.notify.bind(menu);
      root.GBTvMenu.isOpen = menu.isOpen.bind(menu);
      root.GBTvMenu.close = menu.close.bind(menu);
      root.GBTvMenu.show = menu.show.bind(menu);
      root.GBTvMenu.toggle = menu.toggle.bind(menu);
      return menu;
    },
    notify: function () {},
    handleKey: function () { return false; },
    isOpen: function () { return false; },
    toggle: function () {}
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
