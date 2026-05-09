# Airtable connector setup

Holo's Airtable connector reads bases, tables, and records via a **personal access token (PAT)**. Each PAT is scoped to a specific user, a list of bases, and a set of permission scopes — the access boundary is configured in Airtable, mirrored on the Holo side by the connector's allowlist.

## 1. Create the personal access token

1. Visit <https://airtable.com/create/tokens>.
2. **Name** the token something like `Holo (<workspace>)`.
3. Add the following **scopes**:
   - `data.records:read` — read records from tables
   - `schema.bases:read` — list bases and read their table/field schema
   - `user.email:read` — identify the connecting user (used as the `sources.name`)
4. Under **Access**, grant the token access to the **bases** you want Holo to ingest. You can add or remove bases later — the next sync will pick up the new set.
5. Click **Create token** and copy the value. You can only view it once.

## 2. Connect inside Holo

1. Open the Holo dashboard → **Connections** → **Airtable** → **Connect**.
2. Paste the PAT into the form and submit.
3. Holo validates the token via `GET https://api.airtable.com/v0/meta/whoami`, persists it (encrypted) to `connector_credentials`, and enqueues the first sync.

## 3. Allowlist (optional)

The connect route auto-populates a `*` glob in `connector_allowlists` — every base the PAT can see is synced. To narrow the set:

```bash
holo allowlist remove airtable "*"
holo allowlist add airtable appXXXXXXXXXXXXXX
holo allowlist add airtable appYYYYYYYYYYYYYY
```

Allowlist entries match **base ids** (`app…`). The connector skips bases the token can't access (403/404) without aborting the rest of the sync.

## What gets ingested

One chunk per record, with:

- **Content** — `[Base · Table] <primary field value>` followed by `Field: value` lines (rendered in `table.fields` order, empty values skipped).
- **Metadata** — `baseId`, `baseName`, `tableId`, `tableName`, `recordId`, `createdTime`, `url`, `primaryFieldId`, `fieldNames`.
- **ACL subjects** — `airtable:base:<id>` and `airtable:org`.

Incremental syncs use Airtable's `LAST_MODIFIED_TIME()` formula filter, anchored per `(baseId, tableId)` to the highest `createdTime` seen on the previous run. Records edited after that timestamp are picked up; records created earlier and never touched are not re-ingested.

## No env vars

The PAT is collected per-org in the dashboard, not at boot. There are no Airtable env vars to set.

## Rate limits

Airtable publishes a 5 req/sec per-base limit. The framework HTTP client is configured at 4 rps with a burst of 8 globally; if the token reaches a base's limit, the framework's 429 + `Retry-After` handling absorbs the pushback automatically.

See <https://airtable.com/developers/web/api/rate-limits>.
