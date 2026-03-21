// Tray launcher stub: no console window; starts MyHomeGames-Server-Tray.ps1 via PowerShell.
// Build (from repo): GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H windowsgui" -o ../../build/Start-MyHomeGames-Server.exe

//go:build windows

package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const errorLogName = "MyHomeGames-Server-Tray-errors.log"

func appendErrorLog(dir string, section string, body string) {
	path := filepath.Join(dir, errorLogName)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	ts := time.Now().Format(time.RFC3339)
	_, _ = fmt.Fprintf(f, "==== %s ====\n[%s]\n%s\n\n", ts, section, body)
}

func main() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	dir := filepath.Dir(exe)
	ps1 := filepath.Join(dir, "MyHomeGames-Server-Tray.ps1")
	if _, err := os.Stat(ps1); os.IsNotExist(err) {
		msg := "MyHomeGames-Server-Tray.ps1 not found next to this program.\nExpected: " + ps1
		appendErrorLog(dir, "Start-MyHomeGames-Server.exe (missing .ps1)", msg)
		showMsg("MyHomeGames Server", msg+"\n\nDetails saved to:\n"+filepath.Join(dir, errorLogName))
		return
	}
	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1,
	)
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
		appendErrorLog(dir, "Start-MyHomeGames-Server.exe (PowerShell exit)", logBody)
		showMsg("MyHomeGames Server", "Could not start the tray launcher.\n\n"+msg+
			"\n\nFull details saved to:\n"+filepath.Join(dir, errorLogName))
	}
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
