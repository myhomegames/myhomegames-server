# Install with Homebrew (macOS)

MyHomeGames Server for macOS is distributed as a **Cask** that downloads the official `.pkg` (Intel and Apple Silicon) from GitHub Releases.

## For users

### 1. Add the tap

```bash
brew tap myhomegames/myhomegames-homebrewtap
```

Tap repository: [github.com/myhomegames/myhomegames-homebrewtap](https://github.com/myhomegames/myhomegames-homebrewtap)

### 2. Install

```bash
brew install --cask myhomegames-server
```

Homebrew picks the correct `.pkg` (`mac-x64` or `mac-arm64`).

### 3. Run

After installation, **MyHomeGames** appears in `/Applications`. Launch it from Launchpad or Spotlight.

Default configuration:

```
/Applications/MyHomeGames.app/Contents/Resources/.env
```

### Upgrade

```bash
brew update
brew upgrade --cask myhomegames-server
```

### Uninstall

```bash
brew uninstall --cask myhomegames-server
```

## For maintainers (release)

On each `npm run release`:

1. macOS `.pkg` files are uploaded to **GitHub Releases**
2. `scripts/publish-package-repos.js` builds the Cask (version, URL, `sha256`) and pushes it to the tap repository

### Tap repository

Separate repo, e.g. `myhomegames/myhomegames-homebrewtap`:

```
myhomegames-homebrewtap/
└── Casks/
    └── myhomegames-server.rb
```

### Environment variables

```bash
export HOMEBREW_TAP_REPO=git@github.com:myhomegames/myhomegames-homebrewtap.git
export GITHUB_RELEASE_BASE=https://github.com/myhomegames/myhomegames-server/releases/download
```

Then:

```bash
npm run release
```

### Test publish without a full release

```bash
npm run build
npm run publish:repos
```

Requires `HOMEBREW_TAP_REPO` and SSH access to GitHub. The Cask is pushed only to the tap repo (nothing is written under this server project).

### Install without the tap (GitHub Release only)

Download the `.pkg` from [Releases](https://github.com/myhomegames/myhomegames-server/releases) and open it, or:

```bash
sudo installer -pkg ~/Downloads/MyHomeGames-<version>-mac-arm64.pkg -target /
```

Use `mac-x64` on Intel and `mac-arm64` on Apple Silicon.
