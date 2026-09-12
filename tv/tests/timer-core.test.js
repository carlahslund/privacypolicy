/* Session-engine tests. Run with: node tv/tests/timer-core.test.js
   The clock is injected, so a whole class runs in microseconds and the assertions
   pin the exact contract the display and the phone controller depend on. */
'use strict';

var path = require('path');
var { TimerEngine, sanitiseConfig } = require(path.join(__dirname, '..', 'shared', 'web', 'timer-core.js'));

var failures = 0;
var checks = 0;

function check(label, actual, expected) {
  checks += 1;
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) {
    failures += 1;
    console.error('FAIL  ' + label + '\n      expected ' + b + '\n      actual   ' + a);
  }
}

function harness(config) {
  var clock = 0;
  var engine = new TimerEngine({ now: function () { return clock; }, config: config });
  return {
    engine: engine,
    advance: function (seconds) { clock += seconds * 1000; engine.tick(); return this; },
    kinds: function () { return engine.state().events.map(function (e) { return e.kind; }); },
    snapshot: function () {
      var s = engine.state();
      return { phase: s.phase, round: s.round_number, seconds: Math.round(s.seconds), running: s.running };
    }
  };
}

/* --- a full three-round class, start to finish ------------------------------ */
var h = harness({ preset: 'positional', round: 180, rest: 30, rounds: 3, position: 'Half Guard', alternate: true, warning: true, buzzer: 'classic', buzzer_volume: 0.8 });

check('idle before start', h.snapshot(), { phase: 'idle', round: 1, seconds: 180, running: false });
h.engine.action('toggle');
check('round 1 running', h.snapshot(), { phase: 'round', round: 1, seconds: 180, running: true });
check('start fires start_round', h.kinds(), ['start_round']);

h.advance(169);
check('no warning at 11s left', h.kinds(), ['start_round']);
h.advance(1);
check('warning at 10s left', h.kinds(), ['start_round', 'warning']);
check('clock at warning', h.snapshot(), { phase: 'round', round: 1, seconds: 10, running: true });

h.advance(5);
check('warning fires once per round', h.kinds(), ['start_round', 'warning']);

h.advance(5);
check('round 1 ends into rest', h.snapshot(), { phase: 'rest', round: 1, seconds: 30, running: true });
check('end_round buzzer', h.kinds(), ['start_round', 'warning', 'end_round']);

h.advance(30);
check('rest ends into round 2', h.snapshot(), { phase: 'round', round: 2, seconds: 180, running: true });
check('end_rest then start_round', h.kinds().slice(-2), ['end_rest', 'start_round']);

h.advance(210);
check('round 2 and its rest both elapse', h.snapshot(), { phase: 'round', round: 3, seconds: 180, running: true });

h.advance(180);
check('last round completes, no trailing rest', h.snapshot(), { phase: 'complete', round: 3, seconds: 0, running: false });
check('final buzzer', h.kinds().slice(-1), ['end_round']);

h.engine.action('toggle');
check('toggle after complete restarts at round 1', h.snapshot(), { phase: 'round', round: 1, seconds: 180, running: true });

/* --- a stalled shell must not drift the session ----------------------------- */
var stalled = harness({ preset: 'shark', round: 120, rest: 15, rounds: 4, position: '', alternate: false, warning: false, buzzer: 'bell', buzzer_volume: 0.5 });
stalled.engine.action('toggle');
stalled.advance(300);                     /* two whole rounds pass with no tick   */
check('catches up across skipped segments', stalled.snapshot(), { phase: 'round', round: 3, seconds: 90, running: true });

/* --- pause, resume, nudge --------------------------------------------------- */
var p = harness({ preset: 'regular', round: 300, rest: 60, rounds: 5, position: '', alternate: false, warning: true, buzzer: 'classic', buzzer_volume: 0.8 });
p.engine.action('toggle');
p.advance(20);
p.engine.action('toggle');
check('pause holds the clock', p.snapshot(), { phase: 'round', round: 1, seconds: 280, running: false });
p.advance(45);
check('paused clock does not run', p.snapshot(), { phase: 'round', round: 1, seconds: 280, running: false });
p.engine.action('toggle');
p.advance(10);
check('resume continues', p.snapshot(), { phase: 'round', round: 1, seconds: 270, running: true });
p.engine.action('plus');
check('+10 seconds', p.snapshot(), { phase: 'round', round: 1, seconds: 280, running: true });
p.engine.action('minus');
p.engine.action('minus');
check('-10 twice', p.snapshot(), { phase: 'round', round: 1, seconds: 260, running: true });

/* --- skipping is silent ----------------------------------------------------- */
var s = harness({ preset: 'positional', round: 180, rest: 30, rounds: 6, position: '', alternate: false, warning: true, buzzer: 'classic', buzzer_volume: 0.8 });
s.engine.action('toggle');
s.advance(5);
var before = s.kinds().length;
s.engine.action('next');
check('next skips into rest', s.snapshot(), { phase: 'rest', round: 1, seconds: 30, running: true });
check('next does not buzz', s.kinds().length, before);
s.engine.action('next');
check('next again starts round 2', s.snapshot(), { phase: 'round', round: 2, seconds: 180, running: true });
s.advance(40);
s.engine.action('previous');
check('previous mid-round restarts it', s.snapshot(), { phase: 'round', round: 2, seconds: 180, running: true });
s.engine.action('previous');
check('previous at the top steps back a round', s.snapshot(), { phase: 'round', round: 1, seconds: 180, running: true });
s.engine.action('previous');
check('previous stops at round 1', s.snapshot(), { phase: 'round', round: 1, seconds: 180, running: true });
check('skipping stayed silent', s.kinds().length, before);

s.engine.action('reset');
check('reset returns to ready', s.snapshot(), { phase: 'idle', round: 1, seconds: 180, running: false });

/* --- open mat counts up ----------------------------------------------------- */
var o = harness({ preset: 'open', round: 0, rest: 0, rounds: 1, position: '', alternate: false, warning: false, buzzer: 'classic', buzzer_volume: 0.8 });
check('open mat starts at zero', o.snapshot(), { phase: 'idle', round: 1, seconds: 0, running: false });
o.engine.action('toggle');
o.advance(125);
check('open mat counts up', o.snapshot(), { phase: 'round', round: 1, seconds: 125, running: true });
o.advance(600);
check('open mat never completes', o.engine.state().phase, 'round');

/* --- the manual buzzer is the only event it raises --------------------------- */
var b = harness();
b.engine.action('buzzer');
check('manual buzzer event', b.kinds(), ['manual']);
check('manual buzzer leaves the clock alone', b.snapshot(), { phase: 'idle', round: 1, seconds: 180, running: false });

/* --- settings validation matches the server --------------------------------- */
check('rejects zero rounds', sanitiseConfig({ preset: 'regular', round: 300, rest: 60, rounds: 0 }), null);
check('rejects a hundred rounds', sanitiseConfig({ preset: 'regular', round: 300, rest: 60, rounds: 100 }), null);
check('rejects a zero-length round', sanitiseConfig({ preset: 'regular', round: 0, rest: 60, rounds: 5 }), null);
check('rejects rubbish', sanitiseConfig({ preset: 'regular', round: 'soon', rest: 60, rounds: 5 }), null);
check('unknown preset becomes custom', sanitiseConfig({ preset: 'nonsense', round: 90, rest: 15, rounds: 4 }).preset, 'custom');
check('unknown buzzer falls back', sanitiseConfig({ preset: 'regular', round: 300, rest: 60, rounds: 5, buzzer: 'kazoo' }).buzzer, 'classic');
check('volume is clamped', sanitiseConfig({ preset: 'regular', round: 300, rest: 60, rounds: 5, buzzer_volume: 9 }).buzzer_volume, 1);
check('open mat is normalised', sanitiseConfig({ preset: 'open', round: 300, rest: 60, rounds: 5 }), {
  preset: 'open', round: 0, rest: 0, rounds: 1, position: '', alternate: false, warning: false, buzzer: 'classic', buzzer_volume: 0.8
});
check('a custom position survives', sanitiseConfig({ preset: 'custom', round: 90, rest: 20, rounds: 8, position: 'Turtle escapes' }).position, 'Turtle escapes');

/* --- no rest configured: rounds run back to back ---------------------------- */
var n = harness({ preset: 'custom', round: 60, rest: 0, rounds: 3, position: '', alternate: false, warning: false, buzzer: 'digital', buzzer_volume: 1 });
n.engine.action('toggle');
n.advance(60);
check('straight into the next round', n.snapshot(), { phase: 'round', round: 2, seconds: 60, running: true });
check('buzzes between rounds', n.kinds().slice(-2), ['end_round', 'start_round']);

/* --- applying settings restarts the session --------------------------------- */
var c = harness();
c.engine.action('toggle');
c.advance(60);
check('config applied', c.engine.setConfig({ preset: 'ten', round: 600, rest: 60, rounds: 4, position: 'Mount', alternate: true, warning: true, buzzer: 'bell', buzzer_volume: 0.6 }), true);
check('new settings reset the session', c.snapshot(), { phase: 'idle', round: 1, seconds: 600, running: false });
check('bad settings are refused', c.engine.setConfig({ preset: 'ten', round: -5, rest: 60, rounds: 4 }), false);
check('refused settings change nothing', c.engine.state().config.round, 600);

console.log((failures ? 'FAILED' : 'ok') + ' — ' + (checks - failures) + '/' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
