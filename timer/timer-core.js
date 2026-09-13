/* Gracie Barra Round Timer — session engine.
   A port of the state machine that the Windows server (v1.2.2) runs natively, so the
   TV shells produce exactly the payload /api/state has always returned and the same
   buzzer events fire at the same moments. Used directly by the Samsung (Tizen) shell;
   the Android shell runs the Kotlin port in TimerEngine.kt and keeps the two in step. */
(function (root) {
  'use strict';

  var PRESETS = {
    positional: [180, 30],
    regular: [300, 60],
    competition: [360, 60],
    eight: [480, 60],
    ten: [600, 60],
    shark: [120, 15],
    open: [0, 0]
  };
  var PRESET_NAMES = ['regular', 'competition', 'eight', 'ten', 'positional', 'shark', 'open', 'custom'];
  /* The first four are synthesised; the rest are recordings in buzzers/. */
  var BUZZERS = ['classic', 'airhorn', 'bell', 'digital', 'opening', 'boxing', 'boxing3'];
  var MAX_EVENTS = 16;
  var WARNING_AT = 10;
  var NUDGE = 10;
  var PREVIOUS_RESTART_WINDOW = 2;

  var DEFAULT_CONFIG = {
    preset: 'positional',
    round: 180,
    rest: 30,
    rounds: 6,
    position: 'Half Guard',
    alternate: true,
    warning: true,
    buzzer: 'classic',
    buzzer_volume: 0.8
  };

  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

  /* Rejects anything the server would have rejected, and returns a config that is
     safe to run a class from. Returns null when the payload is unusable. */
  function sanitiseConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var preset = PRESET_NAMES.indexOf(raw.preset) >= 0 ? raw.preset : 'custom';
    var round = Math.floor(Number(raw.round));
    var rest = Math.floor(Number(raw.rest));
    var rounds = Math.floor(Number(raw.rounds));
    if (!isFinite(round) || !isFinite(rest) || !isFinite(rounds)) return null;
    if (round < 0 || round > 3599 || rest < 0 || rest > 3599) return null;
    if (rounds < 1 || rounds > 99) return null;
    if (preset !== 'open' && round < 1) return null;
    var volume = Number(raw.buzzer_volume);
    if (!isFinite(volume)) volume = DEFAULT_CONFIG.buzzer_volume;
    return {
      preset: preset,
      round: preset === 'open' ? 0 : round,
      rest: preset === 'open' ? 0 : rest,
      rounds: preset === 'open' ? 1 : rounds,
      position: String(raw.position == null ? '' : raw.position).slice(0, 40),
      alternate: !!raw.alternate,
      warning: !!raw.warning,
      buzzer: BUZZERS.indexOf(raw.buzzer) >= 0 ? raw.buzzer : 'classic',
      buzzer_volume: clamp(Math.round(volume * 100) / 100, 0.1, 1)
    };
  }

  function TimerEngine(options) {
    options = options || {};
    this._now = options.now || function () { return Date.now(); };
    this._onEvent = options.onEvent || function () {};
    this.config = sanitiseConfig(options.config) || Object.assign({}, DEFAULT_CONFIG);
    this._events = [];
    this._eventId = 0;
    this._reset();
  }

  TimerEngine.PRESETS = PRESETS;
  TimerEngine.PRESET_NAMES = PRESET_NAMES;
  TimerEngine.BUZZERS = BUZZERS;
  TimerEngine.DEFAULT_CONFIG = DEFAULT_CONFIG;
  TimerEngine.sanitiseConfig = sanitiseConfig;

  TimerEngine.prototype._isOpen = function () { return this.config.preset === 'open'; };

  TimerEngine.prototype._reset = function () {
    this.phase = 'idle';
    this.round_number = 1;
    this.running = false;
    this.warned = false;
    this._seconds = this._isOpen() ? 0 : this.config.round;
    this._mark = this._now();
  };

  /* Seconds left in the current segment, allowed to go negative so that tick() can
     see how far past the buzzer a stalled shell has drifted. */
  TimerEngine.prototype._rawRemaining = function (at) {
    if (!this.running) return this._seconds;
    var elapsed = (at - this._mark) / 1000;
    if (this._isOpen()) return this._seconds + elapsed;
    return this._seconds - elapsed;
  };

  /* Seconds left in the current segment — counting up for Open Mat, down otherwise. */
  TimerEngine.prototype._remaining = function (at) {
    var left = this._rawRemaining(at);
    return this._isOpen() ? left : Math.max(0, left);
  };

  TimerEngine.prototype._hold = function (at, seconds) {
    this._seconds = seconds;
    this._mark = at;
  };

  TimerEngine.prototype._emit = function (kind, at) {
    this._eventId += 1;
    var event = { id: this._eventId, kind: kind, epoch: (at == null ? Date.now() : at) / 1000 };
    this._events.push(event);
    if (this._events.length > MAX_EVENTS) this._events.shift();
    this._onEvent(event, this);
    return event;
  };

  /* Moves from a finished segment to whatever comes next. Called on expiry and by
     NEXT, which skips a segment silently (no buzzer for a deliberate skip). */
  TimerEngine.prototype._advance = function (at, audible) {
    if (this.phase === 'rest') {
      if (audible) this._emit('end_rest', at);
      this.round_number += 1;
      this.phase = 'round';
      this.warned = false;
      this._hold(at, this.config.round);
      if (audible) this._emit('start_round', at);
      return;
    }
    if (audible) this._emit('end_round', at);
    if (this.round_number >= this.config.rounds) {
      this.phase = 'complete';
      this.running = false;
      this._hold(at, 0);
      return;
    }
    if (this.config.rest > 0) {
      this.phase = 'rest';
      this._hold(at, this.config.rest);
      return;
    }
    this.round_number += 1;
    this.phase = 'round';
    this.warned = false;
    this._hold(at, this.config.round);
    if (audible) this._emit('start_round', at);
  };

  /* Drives expiry and the ten-second warning. Safe to call as often as you like. */
  TimerEngine.prototype.tick = function () {
    var at = this._now();
    if (!this.running || this.phase === 'idle' || this.phase === 'complete') return;
    if (this._isOpen()) return;

    var guard = 0;
    while (guard < 64) {
      var left = this._rawRemaining(at);
      if (this.phase === 'round' && this.config.warning && !this.warned && left > 0 && left <= WARNING_AT) {
        this.warned = true;
        this._emit('warning', at);
      }
      if (left > 0) break;
      /* Roll the clock forward to the instant the segment actually expired, so a
         stalled tick (a backgrounded TV browser) cannot drift the session. */
      var expiredAt = at + left * 1000;
      this._hold(expiredAt, 0);
      this._advance(expiredAt, true);
      if (!this.running) break;
      guard += 1;
    }
  };

  TimerEngine.prototype.action = function (name) {
    var at = this._now();
    this.tick();

    switch (name) {
      case 'toggle':
        if (this.phase === 'complete') this._reset();
        if (this.phase === 'idle') {
          this.phase = 'round';
          this.round_number = 1;
          this.warned = false;
          this._hold(at, this._isOpen() ? 0 : this.config.round);
          this.running = true;
          this._emit('start_round', at);
          return true;
        }
        if (this.running) {
          this._hold(at, this._remaining(at));
          this.running = false;
        } else {
          this._mark = at;
          this.running = true;
        }
        return true;

      case 'reset':
        this._reset();
        return true;

      case 'next':
        if (this.phase === 'idle' || this.phase === 'complete') return true;
        if (this._isOpen()) { this._hold(at, 0); return true; }
        this._hold(at, 0);
        this._advance(at, false);
        return true;

      case 'previous':
        if (this.phase === 'idle') return true;
        if (this._isOpen()) { this._hold(at, 0); return true; }
        if (this.phase === 'complete') {
          this.phase = 'round';
          this.round_number = this.config.rounds;
        } else if (this.phase === 'rest') {
          this.phase = 'round';
        } else if (this._remaining(at) > this.config.round - PREVIOUS_RESTART_WINDOW && this.round_number > 1) {
          /* Near the top of a round, PREVIOUS means the round before it. */
          this.round_number -= 1;
        }
        this.warned = false;
        this._hold(at, this.config.round);
        return true;

      case 'plus':
      case 'minus': {
        if (this.phase === 'idle' || this.phase === 'complete') {
          if (this._isOpen()) return true;
          this._hold(at, Math.max(0, this._seconds + (name === 'plus' ? NUDGE : -NUDGE)));
          return true;
        }
        var left = this._remaining(at);
        var next = name === 'plus' ? left + NUDGE : left - NUDGE;
        this._hold(at, Math.max(0, next));
        if (this.config.warning && this._seconds > WARNING_AT) this.warned = false;
        return true;
      }

      case 'buzzer':
        this._emit('manual', at);
        return true;

      default:
        return false;
    }
  };

  /* Applying settings restarts the session, exactly as the control panel warns. */
  TimerEngine.prototype.setConfig = function (raw) {
    var config = sanitiseConfig(raw);
    if (!config) return false;
    this.config = config;
    this._reset();
    return true;
  };

  TimerEngine.prototype.state = function () {
    this.tick();
    var at = this._now();
    return {
      config: Object.assign({}, this.config),
      phase: this.phase,
      round_number: this.round_number,
      running: this.running,
      seconds: Math.round(this._remaining(at) * 1000) / 1000,
      server_epoch_ms: Date.now(),
      events: this._events.slice()
    };
  };

  var api = {
    TimerEngine: TimerEngine,
    PRESETS: PRESETS,
    PRESET_NAMES: PRESET_NAMES,
    BUZZERS: BUZZERS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    sanitiseConfig: sanitiseConfig
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GBTimer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
