// Single-file Windows launcher: embeds server .exe + tray PS1 + config; extracts to AppData and runs tray.
//go:build windows

package main

import (
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed all:payload
var payload embed.FS

// Set at link time: -ldflags "-X main.appVersion=1.2.3"
var appVersion = "dev"

const errLogName = "MyHomeGames-Server-Tray-errors.log"

func appendErrorLog(dir string, section string, body string) {
	path := filepath.Join(dir, errLogName)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	ts := time.Now().Format(time.RFC3339)
	_, _ = fmt.Fprintf(f, "==== %s ====\n[%s]\n%s\n\n", ts, section, body)
}

func showMsg(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	t, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	m, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return
	}
	messageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0)
}

func localAppData() string {
	d := os.Getenv("LOCALAPPDATA")
	if d == "" {
		return os.TempDir()
	}
	return d
}

func extractDir() string {
	return filepath.Join(localAppData(), "MyHomeGames", "server-runtime", appVersion)
}

func extractPayload(dest string) error {
	return fs.WalkDir(payload, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		path = filepath.ToSlash(path)
		if path == "." {
			return nil
		}
		const prefix = "payload/"
		if !strings.HasPrefix(path, prefix) {
			return nil
		}
		rel := strings.TrimPrefix(path, prefix)
		if rel == ".gitkeep" {
			return nil
		}
		data, err := payload.ReadFile(filepath.ToSlash(path))
		if err != nil {
			return err
		}
		out := filepath.Join(dest, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(out), 0755); err != nil {
			return err
		}
		return os.WriteFile(out, data, 0644)
	})
}

func main() {
	dest := extractDir()
	if err := os.MkdirAll(dest, 0755); err != nil {
		showMsg("MyHomeGames Server", "Could not create data folder:\n"+err.Error())
		return
	}

	lockPath := filepath.Join(dest, ".tray-instance.lock")
	lf, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		if os.IsExist(err) {
			showMsg("MyHomeGames Server", "MyHomeGames Server is already running.\nCheck the system tray (near the clock).\n\nIf not, delete:\n"+lockPath)
			return
		}
		showMsg("MyHomeGames Server", "Could not start:\n"+err.Error())
		return
	}
	_, _ = fmt.Fprintf(lf, "%d", os.Getpid())
	_ = lf.Close()
	defer func() { _ = os.Remove(lockPath) }()

	if err := extractPayload(dest); err != nil {
		appendErrorLog(dest, "Extract payload", err.Error())
		showMsg("MyHomeGames Server", "Could not extract application files.\n\n"+err.Error()+
			"\n\nDetails:\n"+filepath.Join(dest, errLogName))
		return
	}

	ps1 := filepath.Join(dest, "MyHomeGames-Server-Tray.ps1")
	if _, err := os.Stat(ps1); os.IsNotExist(err) {
		msg := "Missing MyHomeGames-Server-Tray.ps1 after extract."
		appendErrorLog(dest, "Missing PS1", msg)
		showMsg("MyHomeGames Server", msg)
		return
	}

	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1,
	)
	cmd.Dir = dest
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stderr, stdout bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String() + "\n" + stdout.String())
		msg := err.Error()
		if detail != "" {
			msg = msg + "\n\n" + detail
		}
		logBody := msg
		if detail != "" {
			logBody = "STDERR/STDOUT:\n" + detail + "\n\nGo error: " + err.Error()
		} else {
			logBody = err.Error()
		}
		appendErrorLog(dest, "Unified launcher (PowerShell exit)", logBody)
		showMsg("MyHomeGames Server", "Could not start the tray launcher.\n\n"+msg+
			"\n\nFull details saved to:\n"+filepath.Join(dest, errLogName))
	}
}
