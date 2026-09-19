# Install with YUM / DNF (RHEL / Alma / Rocky / Fedora)

MyHomeGames Server is available from a [Cloudsmith](https://cloudsmith.io/) RPM repository. Packages are built on each release (`myhomegames-server-<version>-1.x86_64.rpm`).

## Client setup

Run the Cloudsmith setup script (configures the repo file and GPG key):

```bash
curl -sLf 'https://dl.cloudsmith.io/public/myhomegames/myhomegames-server/cfg/setup/bash.rpm.sh' | sudo bash
```

Install:

```bash
sudo dnf makecache
sudo dnf install myhomegames-server
```

On systems that use `yum` instead of `dnf`:

```bash
sudo yum makecache
sudo yum install myhomegames-server
```

If your workspace uses a different Cloudsmith namespace or repository slug, replace `myhomegames/myhomegames-server` in the URL. The **Set Me Up** tab on the repository page has the exact command.

## Upgrade

```bash
sudo dnf upgrade myhomegames-server
```

## Uninstall

```bash
sudo dnf remove myhomegames-server
```

## Binary and service

The package installs the server under `/opt/myhomegames-server` and provides `/usr/bin/myhomegames-server`.

A **systemd** unit is installed as `myhomegames-server.service`. After install it is enabled and started automatically.

```bash
sudo systemctl status myhomegames-server
sudo systemctl start myhomegames-server
sudo systemctl stop myhomegames-server
sudo systemctl restart myhomegames-server
```

Runtime data (metadata, covers, settings) lives in `/var/lib/myhomegames-server`. Config defaults are in `/opt/myhomegames-server/.env`.

Package metadata (`dnf info` / `yum info`) describes MyHomeGames as a self-hosted game library backend (catalog and optional remote play), with homepage and Apache-2.0 license.

## Maintainers

Publishing is automatic on `npm run release` when Cloudsmith env vars are configured. See [install-cloudsmith.md](install-cloudsmith.md).

To smoke-test a locally built `.rpm` (install, enable, start/stop, HTTP) on Rocky/RHEL-like guests, see [test-linux-packages.md](test-linux-packages.md). Confirm `rpm -qp --qf 'OS=%{OS}\n'` prints `linux` before copying the package into a guest.
