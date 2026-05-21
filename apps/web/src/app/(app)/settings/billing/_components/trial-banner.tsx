import Link from 'next/link';
import type { TrialState } from '@holo/billing';

interface Props {
  trial: TrialState;
}

/**
 * Trial-state banner (RFC 0010 / ADR 0007 — W3). Three visible states:
 *
 *   - `active`  — "N days left in your trial" with an upgrade CTA
 *   - `expired` — "Your trial ended" with a stronger CTA
 *   - `none` / `paid` — nothing renders
 */
export function TrialBanner({ trial }: Props) {
  if (trial.kind === 'none' || trial.kind === 'paid') return null;

  if (trial.kind === 'active') {
    return (
      <div className="rounded-md border border-accent/40 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-4 py-3 text-[13px]">
        <span className="text-text">
          <strong className="font-medium">{trial.daysRemaining} day{trial.daysRemaining === 1 ? '' : 's'} left in your trial.</strong>{' '}
          Pick a plan to keep credits flowing and the bot answering questions.
        </span>
        <Link
          href="#plans"
          className="ml-2 text-accent underline-offset-2 hover:underline"
        >
          See plans
        </Link>
      </div>
    );
  }

  // Expired
  return (
    <div className="rounded-md border border-warn/40 bg-[color-mix(in_srgb,var(--warn,#d97706)_10%,transparent)] px-4 py-3 text-[13px]">
      <span className="text-text">
        <strong className="font-medium">Your trial has ended.</strong>{' '}
        The bot stops answering once your remaining credits run out. Upgrade now
        to keep service uninterrupted.
      </span>
      <Link
        href="#plans"
        className="ml-2 text-accent underline-offset-2 hover:underline"
      >
        Upgrade
      </Link>
    </div>
  );
}
