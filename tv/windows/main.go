// Gracie Barra Round Timer — the gym laptop build.
//
// One executable: the session, the TV display, the phone controller and the
// settings file. Nothing to install, the way the 1.2.2 build worked, and speaking
// the same /api routes so a phone that was already paired keeps working.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

const (
	version       = "1.3.0"
	preferredPort = 8765
	portAttempts  = 10
	tick          = 25 * time.Millisecond
)

func main() {
	noBrowser := flag.Bool("no-browser", false, "do not open the TV display automatically")
	port := flag.Int("port", preferredPort, "port to listen on")
	flag.Parse()

	settings := settingsPath()
	engine := NewEngine(loadConfig(settings))

	listener, bound := listen(*port)
	if listener == nil {
		fmt.Printf("Cannot open port %d. Close another running timer or allow this exe through your firewall.\n", *port)
		waitForKey()
		os.Exit(1)
	}

	server := NewServer(engine, bound, func(config Config) { saveConfig(settings, config) })

	go func() {
		for range time.Tick(tick) {
			engine.Tick()
		}
	}()

	display := fmt.Sprintf("http://localhost:%d/display", bound)
	control := fmt.Sprintf("http://localhost:%d/control", bound)
	urls := server.LocalURLs()

	fmt.Printf("Gracie Barra Timer %s running.\n", version)
	fmt.Printf("TV display: %s\n", display)
	fmt.Printf("Laptop settings: %s\n", control)
	if len(urls) > 0 {
		fmt.Printf("Phone address: %s\n", urls[0])
		for _, extra := range urls[1:] {
			fmt.Printf("       or: %s\n", extra)
		}
	} else {
		fmt.Println("No Wi-Fi address detected; enter it manually in Settings")
	}
	fmt.Printf("Phone access code: %s\n", server.pin)
	fmt.Println("Keep this window open. Ctrl+C to close.")

	if !*noBrowser {
		openBrowser(display)
	}

	go func() {
		if err := http.Serve(listener, server.Handler()); err != nil {
			fmt.Println("The timer stopped serving:", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	fmt.Println("Timer closed.")
}

// listen takes the first free port at or after the one asked for, so a second copy
// of the app says something useful instead of dying on a port clash.
func listen(from int) (net.Listener, int) {
	for offset := 0; offset < portAttempts; offset++ {
		candidate := from + offset
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", candidate))
		if err == nil {
			return listener, candidate
		}
	}
	return nil, 0
}

// settings.json sits next to the executable, where the gym can see it.
func settingsPath() string {
	executable, err := os.Executable()
	if err != nil {
		return "settings.json"
	}
	return filepath.Join(filepath.Dir(executable), "settings.json")
}

func loadConfig(path string) Config {
	payload, err := os.ReadFile(path)
	if err != nil {
		return defaultConfig()
	}
	var saved Config
	if json.Unmarshal(payload, &saved) != nil {
		return defaultConfig()
	}
	if clean := Sanitise(saved); clean != nil {
		return *clean
	}
	return defaultConfig()
}

func saveConfig(path string, config Config) {
	payload, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		fmt.Println("Could not save settings:", err)
	}
}

func openBrowser(url string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	if err := command.Start(); err != nil {
		fmt.Println("Open the TV display yourself:", url)
	}
}

// A double-clicked window that closes instantly takes its error message with it.
func waitForKey() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Println("Press Enter to close.")
	fmt.Scanln()
}
