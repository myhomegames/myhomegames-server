# Install with APT (Debian / Ubuntu)

MyHomeGames Server is available from a dedicated APT repository. Packages are built on each release (`myhomegames-server_<version>_amd64.deb`).

## Server prerequisites

On the host that serves the repository (e.g. `packages.myhomegames.vige.it`):

- **nginx** (or another web server) with HTTPS
- **reprepro** to manage the APT pool and indexes
- **GPG** to sign the repository

Example reprepro config (`/var/www/packages/apt/conf/distributions`):

```
Origin: MyHomeGames
Label: MyHomeGames
Suite: stable
Codename: stable
Architectures: amd64
Components: main
Description: MyHomeGames server packages
SignWith: YOUR_GPG_KEY_ID
```

Export the public key:

```bash
gpg --armor --export YOUR_GPG_KEY_ID > /var/www/packages/apt/myhomegames-archive-key.gpg
```

After each release, `npm run release` (with env vars configured) runs:

```bash
reprepro -b /var/www/packages/apt includedeb stable /tmp/myhomegames-server_<version>_amd64.deb
```

## Client setup

Replace the URL if you use a domain other than `packages.myhomegames.vige.it`.

```bash
sudo curl -fsSL https://packages.myhomegames.vige.it/apt/myhomegames-archive-key.gpg \
  -o /usr/share/keyrings/myhomegames.gpg

echo "deb [signed-by=/usr/share/keyrings/myhomegames.gpg] \
https://packages.myhomegames.vige.it/apt stable main" | \
  sudo tee /etc/apt/sources.list.d/myhomegames.list

sudo apt update
sudo apt install myhomegames-server
```

## Upgrade

```bash
sudo apt update
sudo apt upgrade myhomegames-server
```

## Uninstall

```bash
sudo apt remove myhomegames-server
```

## Release environment variables (maintainers)

Set on your Mac (or in `.env.local`, not committed) before `npm run release`:

```bash
export PACKAGE_REPO_SSH=deploy@packages.myhomegames.vige.it
export PACKAGE_REPO_APT_ROOT=/var/www/packages/apt
export PACKAGE_REPO_APT_CODENAME=stable
export PACKAGE_REPO_YUM_ROOT=/var/www/packages/yum/el9/x86_64
```

The binary is installed under `/opt/myhomegames-server`; the `myhomegames-server` command is available in `/usr/bin`.
