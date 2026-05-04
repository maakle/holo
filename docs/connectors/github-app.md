# GitHub App setup (developers + self-hosters)

Holo's GitHub connector is implemented as a **GitHub App**, not an OAuth App. This means **every Holo deployment registers its own App**:

- The Holo team runs an App in our GitHub account that customers of our hosted product install.
- Self-hosters register an App in their own GitHub account that their team installs.
- Local developers register an App in their personal GitHub account for development.

You can't share an App across deployments — the App's webhook URL is set at registration time and points at one host.

## Do I need to do this?

| Scenario | Need to register a local App? |
|---|---|
| Working on the GitHub connector code | **Yes** |
| Working on unrelated parts of Holo, GitHub sync just needs to stay green | **Yes**, once. Reuse it forever. |
| Self-hosting Holo at your company | **Yes**, one-time setup |
| Just running tests / never touching `/connections` | No — env vars are optional, tests stub the API |

If you've previously connected GitHub via the legacy OAuth flow, that no longer works after [PR #45](https://github.com/maakle/holo/pull/45) lands. Re-do the steps below.

## 1. Register the App

Go to <https://github.com/settings/apps/new> (or your org's apps page if you want it owned by an org).

| Field | Value |
|---|---|
| **GitHub App name** | `holo-dev-<your-handle>` (must be globally unique across GitHub) |
| **Description** | "Local development install of Holo's GitHub connector." |
| **Homepage URL** | `http://localhost:3000` |
| **Callback URL** | leave blank |
| **Expire user authorization tokens** | OFF |
| **Request user authorization (OAuth) during installation** | OFF |
| **Enable Device Flow** | OFF |
| **Setup URL** | `http://localhost:3000/api/connectors/github/install-callback` |
| **Redirect on update** | ON |
| **Webhook → Active** | OFF for now (turn on once you have a tunnel — see below) |
| **Webhook URL** | (only if Active is ON) your smee.io / ngrok URL — see below |
| **Webhook secret** | generate with `openssl rand -hex 32`. Save this; you'll add it to `.env`. |

> **Why Setup URL, not Callback URL.** GitHub Apps use *Callback URL* only when you also enable "Request user authorization (OAuth) during installation" — i.e., the user authorizes the App as themselves on top of the install. We don't do that; we want a pure App installation. The post-install redirect for App installations goes to *Setup URL*. If you put our `install-callback` route in the Callback URL field, GitHub will install the App fine but never redirect back to us, so Holo never learns the install happened.

### Permissions

Repository permissions, all **Read-only**:

- Contents
- Issues
- Pull requests
- Metadata

Organization permissions:

- Members → Read-only

Everything else: **No access**.

### Subscribe to events

Once permissions are set, GitHub reveals the relevant event checkboxes. Tick:

- Issues
- Issue comment
- Pull request
- Pull request review
- Pull request review comment
- Push

Skip Installation target, Meta, Security advisory.

### Install scope

**Where can this GitHub App be installed?** → **Any account**. This lets you install it on your personal account and any orgs you administer.

Click **Create GitHub App**.

## 2. Generate a private key

On the App's settings page, scroll to **Private keys** → **Generate a private key**. A `.pem` file downloads.

Encode it as a single-line base64 string:

```bash
base64 -i ~/Downloads/holo-dev-<handle>.*.private-key.pem | tr -d '\n' | pbcopy
```

(macOS — for Linux replace `pbcopy` with `xclip -selection clipboard` or pipe to a file.)

## 3. Wire env vars

Add to your `.env`:

```bash
GITHUB_APP_ID=123456                       # the App ID from the settings page
GITHUB_APP_SLUG=holo-dev-<your-handle>     # the slug in github.com/apps/<slug>
GITHUB_APP_PRIVATE_KEY_B64=<paste base64>  # one line, no quotes needed
GITHUB_APP_WEBHOOK_SECRET=<from step 1>    # only required if webhooks are active
```

You can leave `GITHUB_APP_WEBHOOK_SECRET` blank until Phase 4 webhooks ship.

## 4. Install the App on a repo

After Phase 2 ships, you'll click **Connect** on `/connections` and get redirected to GitHub's installer. Until then, you can install manually for testing:

1. Visit `https://github.com/apps/<your-slug>/installations/new`.
2. Pick your personal account (or an org you admin).
3. Either "All repositories" or pick specific ones.
4. Click **Install**.
5. Note the `installation_id` from the URL you land on (`github.com/settings/installations/<id>`). Until the install-callback ships, you'll need to manually insert into the `github_installations` table to test the worker auth path.

## Webhooks for local dev

GitHub can't reach `localhost`. Two options when you turn on webhooks (Phase 4):

### Option A — smee.io (no install)

1. Visit <https://smee.io/new>, copy the URL.
2. Set the App's Webhook URL to the smee URL.
3. In one terminal: `pnpm dlx smee-client --url <smee-url> --target http://localhost:3000/api/webhooks/github`. Leave it running.

### Option B — ngrok / cloudflared (your own tunnel)

```bash
ngrok http 3000
```

Set the App's Webhook URL to `https://<random>.ngrok.app/api/webhooks/github`. Faster than smee for two-way debugging but the URL changes every time you restart unless you have a paid plan.

## Troubleshooting

- **"GitHub returned 401" when minting an installation token** → the private key doesn't match the App ID. Re-download the `.pem` from the App's settings and re-base64 it. The most common cause is having multiple Holo Apps in your account and copying credentials from the wrong one.
- **"No active GitHub App installation for organization …"** → you've registered the App but haven't installed it on any account yet, or installed it but the install-callback didn't fire (Phase 2 only). Run the manual SQL insert against `github_installations` to test.
- **Permissions changed and existing installations don't get new access** → adding a permission requires every installation to re-authorize. The admin gets an email. There's no way around this; pick the permissions list carefully up front.

## Reference

- [ADR 0005: GitHub App over OAuth](../decisions/0005-github-app-over-oauth.md) — why we made this choice
- [Implementation plan](../designs/github-app-migration.md) — phased rollout
- [GitHub's official App docs](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps)
