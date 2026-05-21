import { holoError, ErrorCode } from '@holo/errors';
import { readEmailEnv } from './env';

/**
 * Low-level Resend HTTP send. The auth package has an identical wrapper at
 * `packages/auth/src/server.ts` — kept separate intentionally so auth's OTP
 * path doesn't take a new runtime dep on @holo/email + React Email. If the
 * two ever drift, the auth one stays the source of truth for sign-in flows
 * and this one for everything else.
 *
 * `provider=console` logs the email locally instead of sending. That's the
 * dev-loop default; production sets EMAIL_PROVIDER=resend.
 */
export async function sendViaResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag: string;
}): Promise<void> {
  const env = readEmailEnv();
  if (env.provider === 'console' || !env.resendApiKey) {
    console.log(
      `[email:${args.tag}] to=${args.to} subject=${JSON.stringify(args.subject)}\n${args.text}`,
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Resend rejected ${args.tag} email (status ${res.status})`,
      cause: await res.text(),
      fix: `Confirm RESEND_API_KEY is valid and EMAIL_FROM (${env.from}) is on a verified domain.`,
    });
  }
}
