'use client';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';
import type { SlackChannelsState } from './slack-channels-step';

export function slackInviteStep(ctx: WizardContext<SlackChannelsState>) {
  return <SlackInviteStep ctx={ctx} />;
}

function SlackInviteStep({ ctx }: { ctx: WizardContext<SlackChannelsState> }) {
  const { state } = ctx;
  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2">
          <div className="text-[13px]">
            <div className="font-medium text-text">Inviting the bot to private channels</div>
            <p className="mt-1 text-text-muted">
              Slack doesn&apos;t let bots discover or auto-join private channels — they only
              appear once you&apos;ve invited the bot. To index a private channel, run{' '}
              <code className="rounded bg-surface-2 px-1">/invite @holo</code> in that channel
              from Slack. The next sync will pick it up automatically.
            </p>
          </div>
        </div>
        {state.needsInvite.length > 0 ? (
          <>
            <p className="text-[12px] text-text-muted">
              These private channels were already in your selection but the bot isn&apos;t a
              member yet:
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-bg p-2">
              {state.needsInvite.map((c) => {
                const href = state.teamId
                  ? `slack://channel?team=${state.teamId}&id=${c.id}`
                  : `https://slack.com/app_redirect?channel=${c.id}`;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="text-[13px] text-text">#{c.name}</span>
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-accent underline-offset-2 hover:underline"
                    >
                      Open in Slack →
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {state.joinedCount > 0 ? (
          <p className="text-[12px] text-text-muted">
            Auto-joined {state.joinedCount} public channel
            {state.joinedCount === 1 ? '' : 's'}. Those will sync regardless of this step.
          </p>
        ) : null}
      </div>
      <AlertDialogFooter>
        <Button variant="secondary" onClick={ctx.goNext}>
          Skip
        </Button>
        <Button variant="primary" onClick={ctx.goNext}>
          Done — continue
        </Button>
      </AlertDialogFooter>
    </>
  );
}
