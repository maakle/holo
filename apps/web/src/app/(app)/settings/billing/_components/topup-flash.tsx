interface Props {
  flash: 'success' | 'cancel' | undefined;
}

/**
 * Inline banner shown above the credit balance after returning from Stripe
 * Checkout for a credit top-up. Mirrors the upgrade flash in `PlanSummary` —
 * the credits land via the `checkout.session.completed` webhook, usually
 * within a second of return.
 */
export function TopupFlash({ flash }: Props) {
  if (!flash) return null;
  if (flash === 'success') {
    return (
      <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success)_8%,transparent)] px-4 py-3 text-[13px] text-text">
        Top-up complete. The credits land in your balance within a minute
        (after Stripe confirms the charge).
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3 text-[13px] text-text-muted">
      Top-up cancelled. No charge was made.
    </div>
  );
}
