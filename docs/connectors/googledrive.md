# Google Drive connector setup

Holo's Google Drive connector uses standard Google OAuth 2.0 (offline-access)
to ingest files from a user's My Drive plus every Shared Drive they can
access. Tokens auto-refresh via the framework's OAuth strategy.

## What's indexed

Files whose body Holo can extract as text without binary parsing:

- Google Docs (`application/vnd.google-apps.document`) — exported as plain text
- Google Sheets (`application/vnd.google-apps.spreadsheet`) — exported as CSV
- Google Slides (`application/vnd.google-apps.presentation`) — exported as plain text
- Plain-text uploads: `text/plain`, `text/markdown`, `text/csv`, `text/html`
  (HTML stripped of tags), `application/json`, `application/xml`

Other formats (PDF, Office docs, images, audio/video) are listed but skipped
during chunking — pure-JS extraction isn't worth the heap cost in the worker.
Add OCR / pdf-text extraction upstream and revisit `chunking.ts` if needed.

Each file is split into ~1500-character chunks (200-char overlap) prefixed
with the file name, owner, and `webViewLink` so retrieval surfaces the source.

## 1. Create the Google Cloud OAuth client

1. Open <https://console.cloud.google.com/apis/credentials> in the project
   you want Holo to live under (create one if you don't have a Google
   Workspace project ready for this).
2. **Enable the Drive API**: APIs & Services → Library → search "Google Drive
   API" → **Enable**.
3. Configure the OAuth consent screen (External or Internal as appropriate).
   Add the scope `https://www.googleapis.com/auth/drive.readonly` to the
   consent screen's scope list.
4. Credentials → **Create Credentials** → **OAuth client ID** → Application
   type: **Web application**.
5. Authorized redirect URIs: add
   `${WEB_PUBLIC_URL}/api/connectors/googledrive/callback`
   (or `${BETTER_AUTH_URL}/...` if you don't run a separate public origin).
6. Copy the generated Client ID and Client Secret.

## 2. Wire the credentials into Holo

Set the following env vars on the web app and worker processes:

```
GOOGLEDRIVE_CONNECTOR_CLIENT_ID=<from step 1.6>
GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET=<from step 1.6>
```

Restart the apps. The `/connections` page will show a "Connect" button for
Google Drive; clicking it kicks off the OAuth flow and triggers an initial
sync on success.

## Scopes

- `https://www.googleapis.com/auth/drive.readonly` — read-only access to
  files and metadata in My Drive and any Shared Drive the user can see.
- `https://www.googleapis.com/auth/userinfo.email` — used by `/about` to
  identify the connecting user (the source row's `name`).

`drive.readonly` is the smallest scope that lets Holo enumerate files,
read content, and follow folder paths. We do **not** request the broad
`drive` scope — Holo never writes back.

## Sync cadence

Every 6 hours by default. Watermark is `modifiedTime`; the cursor is one
RFC 3339 timestamp covering My Drive plus every Shared Drive (Drive returns
results in ascending `modifiedTime` order).
