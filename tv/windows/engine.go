package main

import (
	"math"
	"sync"
	"time"
)

// The session state machine, shared with tv/shared/web/timer-core.js and with the
// Android app's TimerEngine.kt. All three run the same scenarios in their own test
// suites, because a gym can have a phone paired to any of them.

type Config struct {
	Preset    string  `json:"preset"`
	Round     int     `json:"round"`
	Rest      int     `json:"rest"`
	Rounds    int     `json:"rounds"`
	Position  string  `json:"position"`
	Alternate bool    `json:"alternate"`
	Warning   bool    `json:"warning"`
	Buzzer    string  `json:"buzzer"`
	Volume    float64 `json:"buzzer_volume"`
}

type Event struct {
	ID    int64   `json:"id"`
	Kind  string  `json:"kind"`
	Epoch float64 `json:"epoch"`
}

type Snapshot struct {
	Config      Config
	Phase       string
	RoundNumber int
	Running     bool
	Seconds     float64
	Events      []Event
}

var (
	presetNames = []string{"regular", "competition", "eight", "ten", "positional", "shark", "open", "custom"}
	// The first four voices are synthesised in the page; the rest are recordings
	// served from web/buzzers.
	buzzers = []string{"classic", "airhorn", "bell", "digital", "opening", "boxing", "boxing3"}
	actions = []string{"toggle", "reset", "next", "previous", "plus", "minus", "buzzer"}
)

const (
	maxEvents             = 16
	warningAt             = 10.0
	nudge                 = 10.0
	previousRestartWindow = 2.0
)

func defaultConfig() Config {
	return Config{
		Preset: "positional", Round: 180, Rest: 30, Rounds: 6,
		Position: "Half Guard", Alternate: true, Warning: true,
		Buzzer: "classic", Volume: 0.8,
	}
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// Sanitise rejects whatever the original server would have rejected. A nil result
// means the settings are unusable and the session must be left alone.
func Sanitise(raw Config) *Config {
	preset := raw.Preset
	if !contains(presetNames, preset) {
		preset = "custom"
	}
	if raw.Round < 0 || raw.Round > 3599 || raw.Rest < 0 || raw.Rest > 3599 {
		return nil
	}
	if raw.Rounds < 1 || raw.Rounds > 99 {
		return nil
	}
	if preset != "open" && raw.Round < 1 {
		return nil
	}
	open := preset == "open"
	clean := raw
	clean.Preset = preset
	if open {
		clean.Round, clean.Rest, clean.Rounds = 0, 0, 1
		clean.Alternate, clean.Warning = false, false
	}
	if len([]rune(clean.Position)) > 40 {
		clean.Position = string([]rune(clean.Position)[:40])
	}
	if !contains(buzzers, clean.Buzzer) {
		clean.Buzzer = "classic"
	}
	if math.IsNaN(clean.Volume) {
		clean.Volume = 0.8
	}
	clean.Volume = math.Round(clean.Volume*100) / 100
	clean.Volume = math.Max(0.1, math.Min(1, clean.Volume))
	return &clean
}

type Engine struct {
	mu      sync.Mutex
	config  Config
	phase   string
	number  int
	running bool
	warned  bool
	seconds float64
	mark    time.Time
	eventID int64
	events  []Event
	onEvent func(Event, Config)
	now     func() time.Time
}

func NewEngine(config Config) *Engine {
	engine := &Engine{config: config, now: time.Now}
	engine.reset()
	return engine
}

// OnEvent is called on whichever goroutine notices the buzzer is due.
func (e *Engine) OnEvent(handler func(Event, Config)) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.onEvent = handler
}

func (e *Engine) openMat() bool { return e.config.Preset == "open" }

func (e *Engine) reset() {
	e.phase = "idle"
	e.number = 1
	e.running = false
	e.warned = false
	if e.openMat() {
		e.seconds = 0
	} else {
		e.seconds = float64(e.config.Round)
	}
	e.mark = e.now()
}

// rawRemaining is allowed to go negative so tick can see how far past the buzzer a
// stalled machine has drifted — a laptop lid closed mid-round, most often.
func (e *Engine) rawRemaining(at time.Time) float64 {
	if !e.running {
		return e.seconds
	}
	elapsed := at.Sub(e.mark).Seconds()
	if e.openMat() {
		return e.seconds + elapsed
	}
	return e.seconds - elapsed
}

func (e *Engine) remaining(at time.Time) float64 {
	left := e.rawRemaining(at)
	if e.openMat() {
		return left
	}
	return math.Max(0, left)
}

func (e *Engine) hold(at time.Time, seconds float64) {
	e.seconds = seconds
	e.mark = at
}

func (e *Engine) emit(kind string) {
	e.eventID++
	event := Event{ID: e.eventID, Kind: kind, Epoch: float64(time.Now().UnixNano()) / 1e9}
	e.events = append(e.events, event)
	if len(e.events) > maxEvents {
		e.events = e.events[len(e.events)-maxEvents:]
	}
	if e.onEvent != nil {
		e.onEvent(event, e.config)
	}
}

// advance moves on from a finished segment. A deliberate skip passes audible false.
func (e *Engine) advance(at time.Time, audible bool) {
	if e.phase == "rest" {
		if audible {
			e.emit("end_rest")
		}
		e.number++
		e.phase = "round"
		e.warned = false
		e.hold(at, float64(e.config.Round))
		if audible {
			e.emit("start_round")
		}
		return
	}
	if audible {
		e.emit("end_round")
	}
	if e.number >= e.config.Rounds {
		e.phase = "complete"
		e.running = false
		e.hold(at, 0)
		return
	}
	if e.config.Rest > 0 {
		e.phase = "rest"
		e.hold(at, float64(e.config.Rest))
		return
	}
	e.number++
	e.phase = "round"
	e.warned = false
	e.hold(at, float64(e.config.Round))
	if audible {
		e.emit("start_round")
	}
}

func (e *Engine) tick() {
	at := e.now()
	if !e.running || e.phase == "idle" || e.phase == "complete" || e.openMat() {
		return
	}
	for guard := 0; guard < 64; guard++ {
		left := e.rawRemaining(at)
		if e.phase == "round" && e.config.Warning && !e.warned && left > 0 && left <= warningAt {
			e.warned = true
			e.emit("warning")
		}
		if left > 0 {
			break
		}
		// Roll back to the instant the segment really expired, so a machine that
		// slept through three rounds lands where it should instead of drifting.
		expired := at.Add(time.Duration(left * float64(time.Second)))
		e.hold(expired, 0)
		e.advance(expired, true)
		if !e.running {
			break
		}
	}
}

func (e *Engine) Tick() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.tick()
}

func (e *Engine) Action(name string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.tick()
	at := e.now()

	switch name {
	case "toggle":
		if e.phase == "complete" {
			e.reset()
		}
		if e.phase == "idle" {
			e.phase = "round"
			e.number = 1
			e.warned = false
			if e.openMat() {
				e.hold(at, 0)
			} else {
				e.hold(at, float64(e.config.Round))
			}
			e.running = true
			e.emit("start_round")
			return true
		}
		if e.running {
			e.hold(at, e.remaining(at))
			e.running = false
		} else {
			e.mark = at
			e.running = true
		}

	case "reset":
		e.reset()

	case "next":
		if e.phase == "idle" || e.phase == "complete" {
			return true
		}
		e.hold(at, 0)
		if e.openMat() {
			return true
		}
		e.advance(at, false)

	case "previous":
		if e.phase == "idle" {
			return true
		}
		if e.openMat() {
			e.hold(at, 0)
			return true
		}
		switch {
		case e.phase == "complete":
			e.phase = "round"
			e.number = e.config.Rounds
		case e.phase == "rest":
			e.phase = "round"
		case e.remaining(at) > float64(e.config.Round)-previousRestartWindow && e.number > 1:
			e.number--
		}
		e.warned = false
		e.hold(at, float64(e.config.Round))

	case "plus", "minus":
		step := nudge
		if name == "minus" {
			step = -nudge
		}
		if e.phase == "idle" || e.phase == "complete" {
			if e.openMat() {
				return true
			}
			e.hold(at, math.Max(0, e.seconds+step))
			return true
		}
		e.hold(at, math.Max(0, e.remaining(at)+step))
		if e.config.Warning && e.seconds > warningAt {
			e.warned = false
		}

	case "buzzer":
		e.emit("manual")

	default:
		return false
	}
	return true
}

// Apply restarts the session, exactly as the control panel warns it will.
func (e *Engine) Apply(next *Config) bool {
	if next == nil {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.config = *next
	e.reset()
	return true
}

func (e *Engine) Snapshot() Snapshot {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.tick()
	at := e.now()
	events := make([]Event, len(e.events))
	copy(events, e.events)
	return Snapshot{
		Config:      e.config,
		Phase:       e.phase,
		RoundNumber: e.number,
		Running:     e.running,
		Seconds:     math.Round(e.remaining(at)*1000) / 1000,
		Events:      events,
	}
}

func (e *Engine) Config() Config {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.config
}
