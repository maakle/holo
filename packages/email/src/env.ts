import { holoError, ErrorCode } from '@holo/errors';

/**
 * Email config read from process env. Mirrors what `packages/auth` already
 * reads (EMAIL_PROVIDER / RESEND_API_KEY / EMAIL_FROM) so both share the same
 * provider posture: console for local dev, Resend for hosted.
 *
 * `provider === 'console'` is the dev-loop default — emails get logged to
 * stdout instead of going out the wire. Useful when running the worker
 * locally without burning Resend send quota.
 */
export type EmailProvider = 'console' | 'resend';

export interface EmailEnv {
  provider: EmailProvider;
  resendApiKey: string | null;
  from: string;
}

export function readEmailEnv(): EmailEnv {
  const provider = (process.env.EMAIL_PROVIDER ?? 'console').toLowerCase();
  if (provider !== 'console' && provider !== 'resend') {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: `EMAIL_PROVIDER='${provider}' is not supported`,
      fix: "Set EMAIL_PROVIDER=console (logs to stdout) or EMAIL_PROVIDER=resend (calls api.resend.com).",
    });
  }
  const resendApiKey = process.env.RESEND_API_KEY ?? null;
  const from = process.env.EMAIL_FROM ?? 'Holo <noreply@holo.dev>';
  if (provider === 'resend' && !resendApiKey) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'EMAIL_PROVIDER=resend but RESEND_API_KEY is empty',
      fix: 'Set RESEND_API_KEY to a valid Resend secret, or use EMAIL_PROVIDER=console.',
    });
  }
  return { provider, resendApiKey, from };
}
