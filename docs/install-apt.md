# Install with APT (Debian / Ubuntu)

MyHomeGames Server is available from a [Cloudsmith](https://cloudsmith.io/) APT repository. Packages are built on each release (`myhomegames-server_<version>_amd64.deb`).

## Client setup

Run the Cloudsmith setup script (configures the GPG key and `sources.list` entry):

```bash
curl -sLf 'https://dl.cloudsmith.io/public/myhomegames/myhomegames-server/cfg/setup/bash.deb.sh' | sudo bash
sudo apt update
sudo apt install myhomegames-server
```

If your workspace uses a different Cloudsmith namespace or repository slug, replace `myhomegames/myhomegames-server` in the URL. The **Set Me Up** tab on the repository page has the exact command.

## Upgrade

```bash
sudo apt update
sudo apt upgrade myhomegames-server
```

## Uninstall

```bash
sudo apt remove myhomegames-server
```

## Binary location

The server is installed under `/opt/myhomegames-server`; the `myhomegames-server` command is available in `/usr/bin`.

## Maintainers

Publishing is automatic on `npm run release` when Cloudsmith env vars are configured. See [install-cloudsmith.md](install-cloudsmith.md).
