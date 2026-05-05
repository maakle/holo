# Connection Wizard

A generic, declarative wizard that drives every connector's "Connect"
flow. Whether the connector authenticates via OAuth (Slack, GitHub, Grain,
HubSpot) or an API key (Notion, Pylon), the user clicks **Connect** on the
row and walks through the same kind of stepped dialog. New connectors plug
in by registering a config — no bespoke dialog code.

## Why a wizard for every connector

- **Consistency.** Every Connect button does the same thing: opens a wizard.
  No more "OAuth providers redirect, API-key providers show an inline form".
- **Context before action.** Step 1 explains what's about to happen and what
  permissions are involved before the user is dropped into a third-party
  consent screen.
- **Multi-step rooms to grow.** Slack needs channel selection + bot invite +
  first-sync polling. The wizard accommodates that without bespoke
  components per connector.
- **State preserved across OAuth.** OAuth happens in a popup window
  (`@/lib/oauth-popup`), so the wizard stays mounted on the original tab and
  picks up where it left off when the popup posts back.

## File layout

```
connection-wizard/
├── README.md                   # this file
├── types.ts                    # WizardStep, WizardContext, ConnectorWizardConfig
├── connection-wizard.tsx       # the generic <ConnectionWizard> component
├── configs.tsx                 # registry: connector id → config
└── steps/
    ├── oauth-install-step.tsx  # generic OAuth install (popup-based)
    ├── api-key-step.tsx        # generic API-key form
    ├── first-sync-step.tsx     # generic "watch the first sync" poller
    ├── slack-channels-step.tsx # slack-specific channel picker
    └── slack-invite-step.tsx   # slack-specific bot-invite reminder
```

## How it renders

`<ConnectorRow>` renders one `<ConnectionWizard>` per row. Clicking
**Connect** sets `open=true`. The wizard reads its config, renders the
stepper indicator, and delegates the active step's body + footer to that
step's `render(ctx)` function. Steps own their CTA buttons.

`WizardContext` gives steps:

- `meta` — the `ConnectorMeta` (id, displayName, etc.).
- `connected` / `connectedAs` — server-rendered status.
- `state` / `setState` — shared bag for inter-step data (e.g. Slack's
  `needsInvite[]` set in step 2 and read in step 3).
- `goNext()` / `goPrev()` / `close()` — navigation primitives.
- `refreshServer()` — `router.refresh()` for after server-mutating actions.

## Adding a new connector

1. Register the connector in `apps/web/src/lib/connector-registry.ts`.
2. Add a config block to `configs.tsx`. Pick from the existing step kits:

   ```tsx
   const myConfig: ConnectorWizardConfig = {
     initialState: {},
     steps: [
       {
         id: 'install',
         label: 'Authorize',
         render: (ctx) =>
           oauthInstallStep(ctx, {
             installButtonLabel: 'Authorize MyService',
             permissions: [
               'Read your widgets',
               'Disconnect any time from this page',
             ],
           }),
       },
       { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
     ],
   };

   const REGISTRY = { /* ... */ myservice: myConfig };
   ```

3. Done. The row picks it up automatically.

## Built-in steps

### `oauthInstallStep(ctx, args)`

Calls `POST /api/connectors/<id>/initiate`, opens the returned authorize URL
in a popup, listens for the `holo:oauth-complete` postMessage, and on
success calls `refreshServer()` + `goNext()`.

Args:

- `permissions: string[]` — bullet points displayed under the description.
- `installButtonLabel?: string` — CTA label. Default: `Install <name>`.

### `apiKeyStep(ctx, args)`

Renders a password input + Connect button. POSTs the token to
`/api/connectors/<id>/connect`, then `refreshServer()` + `goNext()`.

Args:

- `placeholder: string` — input placeholder.
- `helpText?: string` — explanatory copy above the input.
- `helpUrl?: string` — adds a "Where do I find this? →" link.

### `firstSyncStep(ctx)`

Polls `/api/connectors/<id>/sync-status` every 3s. Surfaces
`chunksIndexed` so the user sees movement. Always closable — sync runs in
the background.

## Writing a custom step

Sometimes a connector needs more than the generics. Slack has two:
`slack-channels-step.tsx` and `slack-invite-step.tsx`. Custom steps follow
the same shape — they're React components rendered by the step's `render`
function:

```tsx
export function myCustomStep(ctx: WizardContext<MyState>) {
  return <MyCustomStep ctx={ctx} />;
}
```

Inside, use `ctx.state` / `ctx.setState` to read or write the shared bag,
and call `ctx.goNext()` / `ctx.close()` from your footer buttons. Render
the body and an `<AlertDialogFooter>` with your CTAs.

When a custom step needs typed shared state, use a strongly-typed
`ConnectorWizardConfig<MyState>` — see `slackConfig` in `configs.tsx`.

## OAuth callback contract

Every OAuth callback redirects to
`/connections/oauth-complete?provider=<id>&status=ok|error[&code&fix]`.
That page postMessages the result to the opener and closes the popup. New
OAuth connectors should follow the same redirect contract — see
`apps/web/src/app/api/connectors/slack/callback/route.ts` as the canonical
example.

## Soft auto-open

Provider-specific page-level components (e.g. `SlackOnboardingTrigger`)
can dispatch `holo:open-wizard:<provider>` with optional
`detail.initialStepId` to pop the wizard at a specific step. Use this when
you want to nudge the user to finish setup (e.g. allowlist is empty after
OAuth completed).
