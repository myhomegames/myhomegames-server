# Install with YUM / DNF (RHEL / Alma / Rocky / Fedora)

MyHomeGames Server is available from a dedicated RPM repository. Packages are built on each release (`myhomegames-server-<version>-1.x86_64.rpm`).

## Server prerequisites

On the host that serves the repository (e.g. `packages.myhomegames.vige.it`):

- **nginx** (or another web server) with HTTPS
- **createrepo_c** to generate YUM/DNF metadata

Recommended layout:

```
/var/www/packages/yum/el9/x86_64/
├── myhomegames-server-1.1.0-1.x86_64.rpm
└── repodata/
    └── repomd.xml
```

After each release, `npm run release` (with env vars configured) copies the RPM and refreshes metadata:

```bash
createrepo_c --update /var/www/packages/yum/el9/x86_64
```

For Fedora you can add a parallel tree (e.g. `f40/x86_64`). For RHEL 8 use `el8/x86_64`.

Optional: GPG-sign RPMs and metadata (`rpm --addsign`, `createrepo_c` with a key).

Publish the same GPG public key used for APT if shared:

```bash
gpg --armor --export YOUR_GPG_KEY_ID > /var/www/packages/apt/myhomegames-archive-key.gpg
```

## Client setup (RHEL 9 / Alma 9 / Rocky 9)

Create `/etc/yum.repos.d/myhomegames.repo`:

```ini
[myhomegames]
name=MyHomeGames Server
baseurl=https://packages.myhomegames.vige.it/yum/el9/x86_64
enabled=1
gpgcheck=1
gpgkey=https://packages.myhomegames.vige.it/apt/myhomegames-archive-key.gpg
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

## Upgrade

```bash
sudo dnf upgrade myhomegames-server
```

## Uninstall

```bash
sudo dnf remove myhomegames-server
```

## Release environment variables (maintainers)

```bash
export PACKAGE_REPO_SSH=deploy@packages.myhomegames.vige.it
export PACKAGE_REPO_YUM_ROOT=/var/www/packages/yum/el9/x86_64
export PACKAGE_REPO_APT_ROOT=/var/www/packages/apt
```

The package installs the server under `/opt/myhomegames-server` and provides `/usr/bin/myhomegames-server`.
