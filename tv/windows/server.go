package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"math/big"
	"net"
	"net/http"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The web layer is staged into web/ by build.sh and baked into the executable, so
// the gym still copies one file onto the laptop and nothing else.
//
//go:embed all:web
var webFiles embed.FS

const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
	"connect-src 'self'; base-uri 'none'; form-action 'self'"

var (
	assetName = regexp.MustCompile(`^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)?\.[a-z0-9]+$`)
	sessionRe = regexp.MustCompile(`(?:^|;\s*)session=([a-f0-9]{32})`)

	types = map[string]string{
		".html": "text/html; charset=utf-8",
		".css":  "text/css; charset=utf-8",
		".js":   "application/javascript; charset=utf-8",
		".png":  "image/png",
		".mp3":  "audio/mpeg",
		".txt":  "text/plain; charset=utf-8",
	}
)

type Server struct {
	engine   *Engine
	pin      string
	port     int
	onConfig func(Config)

	mu     sync.Mutex
	paired map[string]bool
}

func NewServer(engine *Engine, port int, onConfig func(Config)) *Server {
	return &Server{engine: engine, pin: newPin(), port: port, paired: map[string]bool{}, onConfig: onConfig}
}

func newPin() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		// Without a usable random source a pairing code would be guessable, and
		// the original refused to start rather than pretend. So does this.
		panic("secure random generator unavailable")
	}
	return fmt.Sprintf("%06d", n.Int64())
}

func newSession() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		panic("secure random generator unavailable")
	}
	return hex.EncodeToString(buffer)
}

// LocalURLs is every address a phone on the gym Wi-Fi could reach this laptop on.
func (s *Server) LocalURLs() []string {
	urls := []string{}
	interfaces, err := net.Interfaces()
	if err != nil {
		return urls
	}
	for _, network := range interfaces {
		if network.Flags&net.FlagUp == 0 || network.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := network.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			ip, ok := address.(*net.IPNet)
			if !ok {
				continue
			}
			v4 := ip.IP.To4()
			if v4 == nil || v4.IsLoopback() || v4.IsLinkLocalUnicast() {
				continue
			}
			urls = append(urls, fmt.Sprintf("http://%s:%d/control", v4.String(), s.port))
		}
	}
	return urls
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.route)
	return mux
}

func (s *Server) route(writer http.ResponseWriter, request *http.Request) {
	session, fresh := s.session(request)
	if fresh {
		http.SetCookie(writer, &http.Cookie{
			Name: "session", Value: session, Path: "/",
			HttpOnly: true, SameSite: http.SameSiteStrictMode,
		})
	}
	// A request from this machine is the laptop's own screen, and the pairing
	// header carries the same code a phone would have typed.
	trusted := s.isPaired(session) || isLoopback(request) || request.Header.Get("X-Timer-Pin") == s.pin

	target := request.URL.Path
	if request.Method == http.MethodGet {
		switch target {
		case "/", "/display", "/control":
			s.sendAsset(writer, "web/index.html")
			return
		case "/api/state":
			s.sendJSON(writer, http.StatusOK, s.state(trusted))
			return
		}
		name := strings.TrimPrefix(target, "/")
		if assetName.MatchString(name) && types[path.Ext(name)] != "" {
			if _, err := fs.Stat(webFiles, "web/"+name); err == nil {
				s.sendAsset(writer, "web/"+name)
				return
			}
		}
		s.fail(writer, http.StatusNotFound, "Not found")
		return
	}

	if request.Method != http.MethodPost {
		s.fail(writer, http.StatusMethodNotAllowed, "Not found")
		return
	}

	body, err := io.ReadAll(io.LimitReader(request.Body, 8*1024))
	if err != nil {
		s.fail(writer, http.StatusBadRequest, "Invalid request")
		return
	}

	switch target {
	case "/api/pair":
		var payload struct {
			Pin string `json:"pin"`
		}
		if json.Unmarshal(body, &payload) != nil {
			s.fail(writer, http.StatusBadRequest, "Invalid request")
			return
		}
		if payload.Pin != s.pin {
			s.fail(writer, http.StatusForbidden, "Incorrect access code")
			return
		}
		s.mu.Lock()
		s.paired[session] = true
		s.mu.Unlock()
		s.sendJSON(writer, http.StatusOK, map[string]bool{"ok": true})

	case "/api/action":
		if !trusted {
			s.fail(writer, http.StatusForbidden, "Pair this device first")
			return
		}
		var payload struct {
			Action string `json:"action"`
		}
		if json.Unmarshal(body, &payload) != nil {
			s.fail(writer, http.StatusBadRequest, "Invalid request")
			return
		}
		if !s.engine.Action(payload.Action) {
			s.fail(writer, http.StatusBadRequest, "Unknown action")
			return
		}
		s.sendJSON(writer, http.StatusOK, map[string]bool{"ok": true})

	case "/api/config":
		if !trusted {
			s.fail(writer, http.StatusForbidden, "Pair this device first")
			return
		}
		var payload Config
		if json.Unmarshal(body, &payload) != nil {
			s.fail(writer, http.StatusBadRequest, "Invalid request")
			return
		}
		next := Sanitise(payload)
		if !s.engine.Apply(next) {
			s.fail(writer, http.StatusBadRequest, "Invalid settings")
			return
		}
		if s.onConfig != nil {
			s.onConfig(*next)
		}
		s.sendJSON(writer, http.StatusOK, map[string]bool{"ok": true})

	default:
		s.fail(writer, http.StatusNotFound, "Not found")
	}
}

type wireState struct {
	Config        Config   `json:"config"`
	Phase         string   `json:"phase"`
	RoundNumber   int      `json:"round_number"`
	Running       bool     `json:"running"`
	Seconds       float64  `json:"seconds"`
	ServerEpochMs int64    `json:"server_epoch_ms"`
	Paired        bool     `json:"paired"`
	PairPin       *string  `json:"pair_pin"`
	LocalURL      *string  `json:"local_url"`
	LocalURLs     []string `json:"local_urls"`
	Events        []Event  `json:"events"`
}

func (s *Server) state(paired bool) wireState {
	snapshot := s.engine.Snapshot()
	urls := s.LocalURLs()
	state := wireState{
		Config:        snapshot.Config,
		Phase:         snapshot.Phase,
		RoundNumber:   snapshot.RoundNumber,
		Running:       snapshot.Running,
		Seconds:       snapshot.Seconds,
		ServerEpochMs: time.Now().UnixMilli(),
		Paired:        paired,
		LocalURLs:     urls,
		Events:        snapshot.Events,
	}
	if state.Events == nil {
		state.Events = []Event{}
	}
	if paired {
		pin := s.pin
		state.PairPin = &pin
	}
	if len(urls) > 0 {
		first := urls[0]
		state.LocalURL = &first
	}
	return state
}

func (s *Server) session(request *http.Request) (string, bool) {
	if match := sessionRe.FindStringSubmatch(request.Header.Get("Cookie")); match != nil {
		return match[1], false
	}
	return newSession(), true
}

func (s *Server) isPaired(session string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.paired[session]
}

func isLoopback(request *http.Request) bool {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		host = request.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) headers(writer http.ResponseWriter, contentType string) {
	header := writer.Header()
	header.Set("Content-Type", contentType)
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", csp)
}

func (s *Server) sendAsset(writer http.ResponseWriter, name string) {
	payload, err := webFiles.ReadFile(name)
	if err != nil {
		s.fail(writer, http.StatusNotFound, "Not found")
		return
	}
	contentType := types[path.Ext(name)]
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	s.headers(writer, contentType)
	writer.WriteHeader(http.StatusOK)
	writer.Write(payload)
}

func (s *Server) sendJSON(writer http.ResponseWriter, status int, payload any) {
	s.headers(writer, "application/json; charset=utf-8")
	writer.WriteHeader(status)
	json.NewEncoder(writer).Encode(payload)
}

func (s *Server) fail(writer http.ResponseWriter, status int, message string) {
	s.sendJSON(writer, status, map[string]string{"error": message})
}
