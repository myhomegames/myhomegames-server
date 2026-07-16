# Microsoft Store (MSIX)

MyHomeGames Server for Windows can be published to the **Microsoft Store** as an MSIX package. Store re-signs the MSIX (no separate Authenticode cert required for the upload).

End users install with `ms-windows-store://` or from the Store app. GitHub Releases still provide the `.zip` / unified `.exe` for direct download.

## One-time setup (Partner Center)

### Developer account (registration fee)

Open-source licensing (Apache-2.0) does **not** waive Store fees — what matters is the **account type** and **registration path**.

| Account | Typical cost (new flow) | Notes |
|---------|-------------------------|--------|
| **Individual** | **Free** | Solo developers; personal Microsoft account |
| **Company** | **Free** (new flow) or ~$99 (legacy) | Business / organization |

Use the **new onboarding** entry point — otherwise you may still see old fees ($19 individual / $99 company):

1. Go to **[storedeveloper.microsoft.com](https://storedeveloper.microsoft.com)** → **Get started for free**.
2. Choose **Individual developer** (personal) or **Company account** (organization).
3. Complete identity verification; you are redirected to Partner Center.

Avoid legacy sign-up paths (direct Partner Center, Visual Studio, Xbox links) if they show a registration fee.

References: [Individual developer — free registration](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-individual-developer), [Company developer — zero registration fees](https://learn.microsoft.com/en-us/windows/apps/publish/whats-new-company-developer), [Developer account FAQ](https://learn.microsoft.com/en-us/windows/apps/publish/faq/open-developer-account).

There is **no recurring annual fee** for the developer account. MSIX uploaded to the Store is **re-signed by Microsoft** (no separate Authenticode certificate needed for Store distribution).

### App and API setup

1. In Partner Center, reserve the app name and create a **Desktop** / MSIX product.
2. Note the **Product ID** (`MSSTORE_APP_ID`).
3. Under **App identity**, copy:
   - **Package identity name** → `MSSTORE_IDENTITY_NAME` (e.g. `MyHomeGames.Server`)
   - **Publisher** (`CN=...`) → `MSSTORE_IDENTITY_PUBLISHER`
4. Create a **Microsoft Entra ID app registration** linked to Partner Center with Store submission API access. Note:
   - Tenant ID → `MSSTORE_TENANT_ID`
   - Client ID → `MSSTORE_CLIENT_ID`
   - Client secret → `MSSTORE_CLIENT_SECRET`
   - Seller ID → `MSSTORE_SELLER_ID` (Partner Center → Account settings)

Docs: [Microsoft Store Developer CLI](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/overview)

## GitHub Actions (recommended — release from macOS)

When `npm run release` creates a GitHub release, the workflow [`.github/workflows/msstore-release.yml`](../.github/workflows/msstore-release.yml) runs on `windows-latest`:

1. Builds the unified Windows `.exe` (`npm run build:win-unified`)
2. Packs `build/MyHomeGames-<version>-win-x64.msix` (MakeAppx)
3. Submits with `msstore publish`

Add these **repository secrets**:

| Secret | Description |
|--------|-------------|
| `MSSTORE_APP_ID` | Store product ID |
| `MSSTORE_TENANT_ID` | Entra tenant ID |
| `MSSTORE_SELLER_ID` | Partner Center seller ID |
| `MSSTORE_CLIENT_ID` | Entra app client ID |
| `MSSTORE_CLIENT_SECRET` | Entra app client secret |
| `MSSTORE_IDENTITY_PUBLISHER` | `CN=...` from app identity |
| `MSSTORE_IDENTITY_NAME` | Optional package identity name |
| `MSSTORE_PUBLISHER_DISPLAY_NAME` | Optional (default: Luca Stancapiano) |

Manual retry:

```bash
gh workflow run msstore-release.yml -f version=1.1.3
```

## Local Windows publish

On a Windows machine with the [Windows SDK](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/) (MakeAppx) and [Store Developer CLI](https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/overview):

```bash
npm run build:win-unified
npm run build:msix
# env vars in .env.local, then:
node scripts/publish-msstore.js
```

Or run `npm run release` on Windows with Store env vars set — `after:release` builds MSIX and publishes locally.

## Release flow summary

| Step | Where |
|------|--------|
| `npm run build` | Produces `.zip` (+ other platforms) |
| `release-it` | Tag + GitHub release with assets |
| `publish-package-repos.js` | Cloudsmith APT/YUM, Homebrew tap |
| `publish-msstore.js` | Info on macOS; publish on Windows |
| `msstore-release.yml` | MSIX build + Store submit on GitHub release |

Certification in Partner Center can take several hours after submission.
