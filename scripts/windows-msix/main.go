// MSIX entry point. The package already contains the server, tray script, and config
// next to this executable. Windows creates the Start Menu entry from the manifest.
//go:build windows

package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"
)

const errLogName = "MyHomeGames-msix-launcher.log"

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

func dataDir() string {
	return filepath.Join(localAppData(), "MyHomeGames")
}

func appendErrorLog(section, body string) {
	dir := dataDir()
	_ = os.MkdirAll(dir, 0755)
	f, err := os.OpenFile(filepath.Join(dir, errLogName), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	ts := time.Now().Format(time.RFC3339)
	_, _ = fmt.Fprintf(f, "==== %s ====\n[%s]\n%s\n\n", ts, section, body)
}

func startServer(dir string) (*exec.Cmd, error) {
	var exe string
	for _, name := range []string{
		"myhomegames-server-win-x64.exe",
		"myhomegames-server-node18-win-x64.exe",
		"myhomegames-server.exe",
	} {
		candidate := filepath.Join(dir, name)
		if _, err := os.Stat(candidate); err == nil {
			exe = candidate
			break
		}
	}
	if exe == "" {
		return nil, fmt.Errorf("server executable not found in %s", dir)
	}
	cmd := exec.Command(exe)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func packageDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe), nil
}

func main() {
	dir, err := packageDir()
	if err != nil {
		showMsg("MyHomeGames Server", "Could not locate the installed package:\n"+err.Error())
		return
	}

	if err := os.MkdirAll(dataDir(), 0755); err != nil {
		showMsg("MyHomeGames Server", "Could not create data folder:\n"+err.Error())
		return
	}

	lockPath := filepath.Join(dataDir(), ".msix-tray.lock")
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

	ps1 := filepath.Join(dir, "MyHomeGames-Server-Tray.ps1")
	if _, err := os.Stat(ps1); err != nil {
		msg := "Missing MyHomeGames-Server-Tray.ps1 in the package:\n" + dir
		appendErrorLog("Missing PS1", msg)
		showMsg("MyHomeGames Server", msg)
		return
	}

	// PowerShell is outside the package, so it cannot CreateProcess another exe
	// under WindowsApps (Win32 error 5, access denied). This entry process can.
	server, err := startServer(dir)
	if err != nil {
		appendErrorLog("Server process", err.Error())
		showMsg("MyHomeGames Server", "Could not start server:\n"+err.Error()+
			"\n\nDetails:\n"+filepath.Join(dataDir(), errLogName))
		return
	}
	defer func() {
		if server.Process != nil {
			_ = server.Process.Kill()
		}
	}()

	cmd := exec.Command(
		"powershell.exe",
		"-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ps1,
	)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), fmt.Sprintf("MYGAMES_SERVER_PID=%d", server.Process.Pid))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	var stderr, stdout bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		detail := stderr.String() + stdout.String()
		logBody := err.Error()
		if detail != "" {
			logBody = "STDERR/STDOUT:\n" + detail + "\n\nGo error: " + err.Error()
		}
		appendErrorLog("Tray launcher", logBody)
		showMsg("MyHomeGames Server", "Could not start the tray launcher.\n\n"+err.Error()+
			"\n\nDetails:\n"+filepath.Join(dataDir(), errLogName))
	}
}
