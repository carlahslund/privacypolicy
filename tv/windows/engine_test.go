package main

import (
	"fmt"
	"math"
	"testing"
	"time"
)

// The same scenarios tv/tests/timer-core.test.js and TimerEngineTest.kt run. Three
// implementations of one state machine only stay honest if they answer the same
// questions.

type harness struct {
	clock  time.Time
	engine *Engine
}

func newHarness(config Config) *harness {
	h := &harness{clock: time.Unix(1700000000, 0)}
	h.engine = &Engine{config: config, now: func() time.Time { return h.clock }}
	h.engine.reset()
	return h
}

func (h *harness) advance(seconds float64) {
	h.clock = h.clock.Add(time.Duration(seconds * float64(time.Second)))
	h.engine.Tick()
}

func (h *harness) where() string {
	s := h.engine.Snapshot()
	return fmt.Sprintf("%s/%d/%d/%t", s.Phase, s.RoundNumber, int(math.Round(s.Seconds)), s.Running)
}

func (h *harness) kinds() []string {
	out := []string{}
	for _, event := range h.engine.Snapshot().Events {
		out = append(out, event.Kind)
	}
	return out
}

func (h *harness) last(n int) []string {
	kinds := h.kinds()
	if len(kinds) < n {
		return kinds
	}
	return kinds[len(kinds)-n:]
}

func equal(t *testing.T, label string, actual, expected any) {
	t.Helper()
	if fmt.Sprint(actual) != fmt.Sprint(expected) {
		t.Errorf("%s\n  expected %v\n  actual   %v", label, expected, actual)
	}
}

var positional = Config{Preset: "positional", Round: 180, Rest: 30, Rounds: 3, Position: "Half Guard",
	Alternate: true, Warning: true, Buzzer: "classic", Volume: 0.8}

func TestRunsAWholeClass(t *testing.T) {
	h := newHarness(positional)
	equal(t, "ready", h.where(), "idle/1/180/false")

	h.engine.Action("toggle")
	equal(t, "round one running", h.where(), "round/1/180/true")
	equal(t, "start fires start_round", h.kinds(), []string{"start_round"})

	h.advance(169)
	equal(t, "no warning at eleven seconds", h.kinds(), []string{"start_round"})
	h.advance(1)
	equal(t, "warning at ten", h.kinds(), []string{"start_round", "warning"})
	h.advance(5)
	equal(t, "the warning fires once a round", h.kinds(), []string{"start_round", "warning"})

	h.advance(5)
	equal(t, "round one ends into rest", h.where(), "rest/1/30/true")
	equal(t, "end_round buzzer", h.last(1), []string{"end_round"})

	h.advance(30)
	equal(t, "rest ends into round two", h.where(), "round/2/180/true")
	equal(t, "end_rest then start_round", h.last(2), []string{"end_rest", "start_round"})

	h.advance(210)
	equal(t, "round two and its rest both elapse", h.where(), "round/3/180/true")

	h.advance(180)
	equal(t, "the last round has no trailing rest", h.where(), "complete/3/0/false")

	h.engine.Action("toggle")
	equal(t, "toggle after complete restarts", h.where(), "round/1/180/true")
}

func TestStallDoesNotDrift(t *testing.T) {
	h := newHarness(Config{Preset: "shark", Round: 120, Rest: 15, Rounds: 4, Buzzer: "bell", Volume: 0.5})
	h.engine.Action("toggle")
	h.advance(300)
	equal(t, "catches up across skipped segments", h.where(), "round/3/90/true")
}

func TestPauseResumeNudge(t *testing.T) {
	h := newHarness(Config{Preset: "regular", Round: 300, Rest: 60, Rounds: 5, Warning: true, Buzzer: "classic", Volume: 0.8})
	h.engine.Action("toggle")
	h.advance(20)
	h.engine.Action("toggle")
	equal(t, "pause holds the clock", h.where(), "round/1/280/false")
	h.advance(45)
	equal(t, "a paused clock stays put", h.where(), "round/1/280/false")
	h.engine.Action("toggle")
	h.advance(10)
	equal(t, "resume continues", h.where(), "round/1/270/true")
	h.engine.Action("plus")
	equal(t, "plus ten", h.where(), "round/1/280/true")
	h.engine.Action("minus")
	h.engine.Action("minus")
	equal(t, "minus twenty", h.where(), "round/1/260/true")
}

func TestSkippingIsSilent(t *testing.T) {
	h := newHarness(Config{Preset: "positional", Round: 180, Rest: 30, Rounds: 6, Warning: true, Buzzer: "classic", Volume: 0.8})
	h.engine.Action("toggle")
	h.advance(5)
	before := len(h.kinds())

	h.engine.Action("next")
	equal(t, "next skips into rest", h.where(), "rest/1/30/true")
	h.engine.Action("next")
	equal(t, "next again starts round two", h.where(), "round/2/180/true")
	h.advance(40)
	h.engine.Action("previous")
	equal(t, "previous mid-round restarts it", h.where(), "round/2/180/true")
	h.engine.Action("previous")
	equal(t, "previous at the top steps back", h.where(), "round/1/180/true")
	h.engine.Action("previous")
	equal(t, "previous stops at round one", h.where(), "round/1/180/true")
	equal(t, "no buzzer for a deliberate skip", len(h.kinds()), before)

	h.engine.Action("reset")
	equal(t, "reset returns to ready", h.where(), "idle/1/180/false")
}

func TestOpenMatCountsUp(t *testing.T) {
	h := newHarness(Config{Preset: "open", Rounds: 1, Buzzer: "classic", Volume: 0.8})
	equal(t, "starts at zero", h.where(), "idle/1/0/false")
	h.engine.Action("toggle")
	h.advance(125)
	equal(t, "counts up", h.where(), "round/1/125/true")
	h.advance(600)
	equal(t, "never completes", h.engine.Snapshot().Phase, "round")
}

func TestManualBuzzer(t *testing.T) {
	h := newHarness(defaultConfig())
	h.engine.Action("buzzer")
	equal(t, "manual event", h.kinds(), []string{"manual"})
	equal(t, "clock untouched", h.where(), "idle/1/180/false")
}

func TestBackToBackRounds(t *testing.T) {
	h := newHarness(Config{Preset: "custom", Round: 60, Rest: 0, Rounds: 3, Buzzer: "digital", Volume: 1})
	h.engine.Action("toggle")
	h.advance(60)
	equal(t, "straight into the next round", h.where(), "round/2/60/true")
	equal(t, "buzzes between rounds", h.last(2), []string{"end_round", "start_round"})
}

func TestSettingsValidation(t *testing.T) {
	base := Config{Preset: "regular", Round: 300, Rest: 60, Rounds: 5, Buzzer: "classic", Volume: 0.8}

	with := func(change func(*Config)) Config {
		copied := base
		change(&copied)
		return copied
	}

	equal(t, "rejects zero rounds", Sanitise(with(func(c *Config) { c.Rounds = 0 })), (*Config)(nil))
	equal(t, "rejects a hundred rounds", Sanitise(with(func(c *Config) { c.Rounds = 100 })), (*Config)(nil))
	equal(t, "rejects a zero-length round", Sanitise(with(func(c *Config) { c.Round = 0 })), (*Config)(nil))
	equal(t, "unknown preset becomes custom", Sanitise(with(func(c *Config) { c.Preset = "nonsense" })).Preset, "custom")
	equal(t, "unknown buzzer falls back", Sanitise(with(func(c *Config) { c.Buzzer = "kazoo" })).Buzzer, "classic")
	equal(t, "volume is clamped", Sanitise(with(func(c *Config) { c.Volume = 9 })).Volume, 1.0)

	for _, name := range []string{"opening", "boxing", "boxing3"} {
		equal(t, "the recorded bell "+name+" is accepted",
			Sanitise(with(func(c *Config) { c.Buzzer = name })).Buzzer, name)
	}

	open := Sanitise(with(func(c *Config) { c.Preset = "open" }))
	equal(t, "open mat is normalised", fmt.Sprintf("%d/%d/%d/%t", open.Round, open.Rest, open.Rounds, open.Warning), "0/0/1/false")

	long := Sanitise(with(func(c *Config) { c.Position = "abcdefghij abcdefghij abcdefghij abcdefghij abcdefghij" }))
	equal(t, "a long position is trimmed", len([]rune(long.Position)), 40)
}

func TestApplyRestartsTheSession(t *testing.T) {
	h := newHarness(defaultConfig())
	h.engine.Action("toggle")
	h.advance(60)
	equal(t, "applied", h.engine.Apply(Sanitise(Config{Preset: "ten", Round: 600, Rest: 60, Rounds: 4, Buzzer: "boxing3", Volume: 0.6})), true)
	equal(t, "new settings reset the session", h.where(), "idle/1/600/false")
	equal(t, "bad settings are refused", h.engine.Apply(Sanitise(Config{Preset: "ten", Round: -5, Rest: 60, Rounds: 4})), false)
	equal(t, "refused settings change nothing", h.engine.Config().Round, 600)
}

func TestUnknownActionsAreRefused(t *testing.T) {
	h := newHarness(defaultConfig())
	equal(t, "nonsense is refused", h.engine.Action("selfDestruct"), false)
	for _, name := range actions {
		equal(t, name+" is accepted", h.engine.Action(name), true)
	}
}
