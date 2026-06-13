# Cloudsmith (maintainers)

APT and YUM/DNF packages are published to [Cloudsmith](https://cloudsmith.io/) on each release. End-user install instructions are in [install-apt.md](install-apt.md) and [install-yum.md](install-yum.md).

## One-time setup

1. Create a [Cloudsmith](https://cloudsmith.io/) account (or use an existing workspace).
2. Create a repository for Debian/RPM packages. For open source projects, apply for the [Open Source plan](https://help.cloudsmith.io/docs/open-source-policy) (50 GB storage, public repo).
3. Note the **namespace** (owner) and **repository slug** — e.g. `myhomegames` / `myhomegames-server`.
4. Generate an API key: **Settings → API Keys** (needs upload permission on the repository).

## Release environment

Add to `.env.local` (not committed):

```bash
export CLOUDSMITH_API_KEY=cs_api_xxxxxxxx
export CLOUDSMITH_OWNER=myhomegames
export CLOUDSMITH_REPO=myhomegames-server

# Optional — defaults work for generic amd64 packages
export CLOUDSMITH_DEB_DISTRO=any-distro
export CLOUDSMITH_DEB_VERSION=any-version
export CLOUDSMITH_RPM_DISTRO=el
export CLOUDSMITH_RPM_VERSION=9
```

On `npm run release`, `scripts/publish-package-repos.js` uploads the `.deb` and `.rpm` from `build/` via the Cloudsmith API.

Test without a full release:

```bash
npm run build
npm run publish:repos
```

## Manual upload (CLI)

Alternatively, install the [Cloudsmith CLI](https://help.cloudsmith.io/docs/cloudsmith-cli) and push packages by hand:

```bash
cloudsmith push deb myhomegames/myhomegames-server/any-distro/any-version \
  build/myhomegames-server_<version>_amd64.deb

cloudsmith push rpm myhomegames/myhomegames-server/el/9 \
  build/myhomegames-server-<version>-1.x86_64.rpm
```

## Client setup URLs

After the repository is public, Cloudsmith provides setup scripts:

- Debian/Ubuntu: `https://dl.cloudsmith.io/public/<owner>/<repo>/cfg/setup/bash.deb.sh`
- RHEL/Fedora: `https://dl.cloudsmith.io/public/<owner>/<repo>/cfg/setup/bash.rpm.sh`

Repository page → **Set Me Up** has copy-paste commands with the correct owner/repo.
