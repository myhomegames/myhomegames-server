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

## Binary location

The package installs the server under `/opt/myhomegames-server` and provides `/usr/bin/myhomegames-server`.

## Maintainers

Publishing is automatic on `npm run release` when Cloudsmith env vars are configured. See [install-cloudsmith.md](install-cloudsmith.md).
