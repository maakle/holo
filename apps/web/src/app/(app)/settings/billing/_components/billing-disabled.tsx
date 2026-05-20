export function BillingDisabled() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="font-display text-h2 font-semibold tracking-tight">
          Billing
        </h2>
        <p className="text-[15px] leading-6 text-text-muted">
          Billing is disabled in this self-hosted installation.
        </p>
      </header>
      <div className="rounded-md border border-border bg-surface p-4 text-[13px] leading-5 text-text-muted">
        <p>
          Holo Community Edition is free to self-host under the AGPL-3.0 license.
          Connector limits, credit metering, and plan subscriptions only apply
          on hosted holo. Set{' '}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-text">
            HOLO_BILLING_ENABLED=true
          </code>{' '}
          to opt in to billing locally.
        </p>
      </div>
    </div>
  );
}
