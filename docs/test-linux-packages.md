# Test Linux packages (.deb / .rpm) and systemd

This guide is for developers who need to verify that release packages install correctly, enable a systemd unit, and start/stop cleanly on **two** target families:

| Package | Typical guest | Package manager |
|---------|---------------|-----------------|
| `myhomegames-server_<version>_amd64.deb` | Ubuntu / Debian | `dpkg` / `apt` |
| `myhomegames-server-<version>-1.x86_64.rpm` | Rocky / Alma / RHEL / Fedora | `rpm` / `dnf` |

End-user install docs: [install-apt.md](install-apt.md), [install-yum.md](install-yum.md).

## What “good” looks like

After install on a real Linux guest with systemd:

1. Unit file present: `/lib/systemd/system/myhomegames-server.service` (or `/usr/lib/...`).
2. `systemctl is-enabled myhomegames-server` → `enabled`.
3. Service is `active` (postinst / `%post` starts it).
4. `systemctl stop` → `inactive`; `systemctl start` → `active`.
5. Process listens on the configured HTTP port (default `4000`) and responds (often `302` to the frontend URL).

Optional journal noise that is **not** a packaging failure: missing Sunshine linux/x64 asset, Moonlight Web download, skin install.

## Build packages on the host

From this repository:

```bash
npm install
# macOS: needed for .rpm
brew install rpm   # provides rpmbuild

npm run build
ls -lh build/myhomegames-server_*_amd64.deb \
       build/myhomegames-server-*-1.x86_64.rpm
```

### macOS + RPM: Linux OS tag

`rpm-builder` calls `rpmbuild` without a target. On macOS that can tag the package `OS=darwin`, and Rocky/RHEL refuse install (`intended for a different operating system`).

The build script forces `rpmbuild --target x86_64-linux`. Verify before testing:

```bash
rpm -qp --qf 'OS=%{OS} ARCH=%{ARCH}\n' build/myhomegames-server-*-1.x86_64.rpm
# expect: OS=linux ARCH=x86_64
```

## Recommended: Lima VMs (Apple Silicon or Intel)

Docker `--platform linux/amd64` on Apple Silicon is **not** enough to validate systemd: QEMU userspace often breaks `systemctl start` even for `/bin/sleep`. Use a full-system x86_64 VM (Lima + QEMU) or a native Linux machine / cloud VM.

### Host prerequisites

```bash
brew install lima qemu
# x86_64 guest on Apple Silicon also needs the additional guest agent:
brew install lima-additional-guestagents
```

### Disk space (important on small Mac SSDs)

Lima downloads cloud images into `~/Library/Caches/lima` (multi‑GB). If the system volume is nearly full:

1. Put `LIMA_HOME` on a large volume (short path — Unix socket paths must stay under ~104 characters).
2. Move or symlink the Lima download cache to that volume.

Example layout used in local smoke tests:

```text
LIMA_HOME=/path/to/short/mhg-lima          # instances
~/Library/Caches/lima → /path/to/mhg-lima-cache
TMPDIR=/path/to/large/tmp                  # qemu / lima temp
```

Path length check:

```bash
python3 -c 'p="/path/to/mhg-lima/mhg-rocky/ssh.sock.1234567890123456"; print(len(p), "OK" if len(p)<104 else "TOO LONG")'
```

Keep instance names short (e.g. `mhg-deb`, `mhg-rpm`).

### Create guests from repo templates

Templates (no host mounts — packages are copied with `limactl copy`):

- [`scripts/linux/smoke/lima-ubuntu-24.04-x86_64.yaml`](../scripts/linux/smoke/lima-ubuntu-24.04-x86_64.yaml)
- [`scripts/linux/smoke/lima-rocky-9-x86_64.yaml`](../scripts/linux/smoke/lima-rocky-9-x86_64.yaml)

```bash
export LIMA_HOME="${LIMA_HOME:-$HOME/.lima}"   # or your short external path
export TMPDIR="${TMPDIR:-/tmp}"

REPO="$(pwd)"   # myhomegames-server root

limactl create --name=mhg-deb  "$REPO/scripts/linux/smoke/lima-ubuntu-24.04-x86_64.yaml"
limactl create --name=mhg-rpm  "$REPO/scripts/linux/smoke/lima-rocky-9-x86_64.yaml"

limactl start mhg-deb
limactl start mhg-rpm
```

First boot of an x86_64 guest on Apple Silicon (TCG) can take several minutes.

### Install and verify — Debian package (Ubuntu)

```bash
DEB=$(ls -1 "$REPO"/build/myhomegames-server_*_amd64.deb | tail -1)
limactl copy "$DEB" mhg-deb:/tmp/myhomegames-server.deb
limactl shell mhg-deb -- sudo dpkg -i /tmp/myhomegames-server.deb
limactl copy "$REPO/scripts/linux/smoke/guest-verify.sh" mhg-deb:/tmp/guest-verify.sh
limactl shell mhg-deb -- bash /tmp/guest-verify.sh
```

### Install and verify — RPM package (Rocky)

```bash
RPM=$(ls -1 "$REPO"/build/myhomegames-server-*-1.x86_64.rpm | tail -1)
limactl copy "$RPM" mhg-rpm:/tmp/myhomegames-server.rpm
limactl shell mhg-rpm -- sudo rpm -Uvh /tmp/myhomegames-server.rpm
limactl copy "$REPO/scripts/linux/smoke/guest-verify.sh" mhg-rpm:/tmp/guest-verify.sh
limactl shell mhg-rpm -- bash /tmp/guest-verify.sh
```

### Manual checks inside a guest

```bash
systemctl status myhomegames-server --no-pager -l
sudo systemctl stop myhomegames-server
systemctl is-active myhomegames-server    # inactive
sudo systemctl start myhomegames-server
systemctl is-active myhomegames-server    # active
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/
journalctl -u myhomegames-server -n 50 --no-pager
```

### Stop VMs when done

```bash
limactl stop mhg-deb
limactl stop mhg-rpm
```

## Alternative: native / cloud Linux

Any amd64 Ubuntu/Debian or Rocky/Alma/RHEL host with systemd works. Copy the package over SSH/SCP, then:

```bash
# Ubuntu/Debian
sudo dpkg -i myhomegames-server_*_amd64.deb
# or: sudo apt install ./myhomegames-server_*_amd64.deb

# Rocky/Alma/RHEL
sudo rpm -Uvh myhomegames-server-*-1.x86_64.rpm
# or: sudo dnf install ./myhomegames-server-*-1.x86_64.rpm

bash guest-verify.sh   # from scripts/linux/smoke/
```

## What not to rely on

| Approach | Why it is incomplete |
|----------|----------------------|
| Docker `linux/amd64` on Apple Silicon | Packaging/`dpkg -i` may work; `systemctl start` often fails under QEMU userspace |
| Testing only `.deb` or only `.rpm` | Scripts and unit are shared, but install hooks (`postinst` vs `%post`) differ by format |
| `.tar.gz` alone | Does not exercise package maintainer scripts; unit must be installed by hand |

## Unit and maintainer scripts (source of truth)

| File | Role |
|------|------|
| `scripts/linux/myhomegames-server.service` | systemd unit |
| `scripts/linux/postinst.sh` | Debian: enable + start |
| `scripts/linux/prerm.sh` | Debian: stop (+ disable on remove) |
| `scripts/linux/postrm.sh` | Debian: `daemon-reload` |
| `scripts/build-app.js` | Embeds the same logic in RPM `%post` / `%preun` / `%postun` |

## Packaging layout reminder

- Binary + `.env`: `/opt/myhomegames-server/`
- Wrapper: `/usr/bin/myhomegames-server`
- Unit: `/lib/systemd/system/myhomegames-server.service`
- Runtime data: `/var/lib/myhomegames-server` (`METADATA_PATH`)
