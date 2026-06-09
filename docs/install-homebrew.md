# Install with Homebrew (macOS)

MyHomeGames Server for macOS is distributed as a **Cask** that downloads the official `.pkg` (Intel and Apple Silicon) from GitHub Releases.

## For users

### 1. Add the tap

```bash
brew tap myhomegames/tap
```

Tap repository: [github.com/myhomegames/homebrew-tap](https://github.com/myhomegames/homebrew-tap)

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
2. `scripts/publish-package-repos.js` updates the Cask with version, URL, and `sha256`
3. If configured, it pushes to the tap repository

### Tap repository

Create an empty GitHub repo, e.g. `myhomegames/homebrew-tap`, with:

```
homebrew-tap/
└── Casks/
    └── myhomegames-server.rb
```

### Environment variables

```bash
export HOMEBREW_TAP_REPO=git@github.com:myhomegames/homebrew-tap.git
export GITHUB_RELEASE_BASE=https://github.com/myhomegames/myhomegames-server/releases/download
```

Then:

```bash
npm run release
```

The script also writes a local copy to `packaging/homebrew/Casks/myhomegames-server.rb` (reference in the server repo).

### Manual Cask publish

To skip automatic git push:

```bash
npm run build
node scripts/publish-package-repos.js
```

Copy the generated `packaging/homebrew/Casks/myhomegames-server.rb` into the `homebrew-tap` repo and commit/push.

### Install without the tap (GitHub Release only)

Download the `.pkg` from [Releases](https://github.com/myhomegames/myhomegames-server/releases) and open it, or:

```bash
sudo installer -pkg ~/Downloads/MyHomeGames-<version>-mac-arm64.pkg -target /
```

Use `mac-x64` on Intel and `mac-arm64` on Apple Silicon.
