import type { Hono } from 'hono';
import { loadChatAppAccessToken } from '@holo/connectors';
import { logger } from '../logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountHealthzOptions {
  audience: string | undefined;
  serviceAccountJson: string | undefined;
}

interface HealthzReport {
  audience: 'set' | 'unset';
  serviceAccount: 'unset' | 'malformed' | 'ok';
  serviceAccountClientEmail: string | null;
  tokenExchange: 'skipped' | 'ok' | 'failed';
  tokenExchangeError: string | null;
}

/**
 * Operator-facing health endpoint for the shared Google Chat App. No auth —
 * deliberately public, like other /healthz endpoints. Reports whether env
 * is configured and whether the SA key is valid enough to mint a token
 * against Google's OAuth endpoint. Never exposes the private key.
 *
 * Mounted at GET /google-chat-app/healthz. Use from the dashboard's
 * "Verify deployment" button — or curl from a deploy script.
 */
export function mountGoogleChatAppHealthz(
  app: AnyHono,
  opts: MountHealthzOptions,
): void {
  app.get('/google-chat-app/healthz', async (c) => {
    const report: HealthzReport = {
      audience: opts.audience ? 'set' : 'unset',
      serviceAccount: 'unset',
      serviceAccountClientEmail: null,
      tokenExchange: 'skipped',
      tokenExchangeError: null,
    };

    if (!opts.serviceAccountJson) {
      return c.json(report, 200);
    }

    // Probe the SA by attempting to mint a real bearer token. This proves:
    //   - the JSON parses and has the required fields
    //   - the PEM private_key is a valid RSA key
    //   - Google accepts our signature with the chat.bot scope
    // Failure cases (invalid key, disabled SA, missing Chat API) all funnel
    // here, so an "ok" result is a strong end-to-end signal.
    try {
      const token = await loadChatAppAccessToken({
        serviceAccountJson: opts.serviceAccountJson,
      });
      report.serviceAccount = 'ok';
      report.tokenExchange = 'ok';
      // Best-effort client_email surface — parseServiceAccountKey ran inside
      // loadChatAppAccessToken; re-parse the JSON locally to extract it for
      // the dashboard. If parsing fails here, the call above would have
      // already thrown, so we can be loose with errors.
      try {
        const parsed = JSON.parse(opts.serviceAccountJson) as {
          client_email?: string;
        };
        report.serviceAccountClientEmail = parsed.client_email ?? null;
      } catch {
        report.serviceAccountClientEmail = null;
      }
      // Suppress unused-var lint
      void token;
    } catch (err) {
      logger.warn({ err }, 'google-chat-app healthz: token mint failed');
      // HoloError exposes a `.problem` message; fall back to generic.
      const msg =
        err && typeof err === 'object' && 'problem' in err
          ? String((err as { problem: unknown }).problem)
          : err instanceof Error
            ? err.message
            : 'unknown';
      // Tease apart the two failure modes the operator can act on:
      //   - JSON/PEM parse error  → serviceAccount: 'malformed'
      //   - OAuth exchange failed → serviceAccount: 'ok', tokenExchange: 'failed'
      if (/private_key|JSON|service account key/i.test(msg)) {
        report.serviceAccount = 'malformed';
      } else {
        report.serviceAccount = 'ok';
        report.tokenExchange = 'failed';
      }
      report.tokenExchangeError = msg;
    }

    return c.json(report, 200);
  });
}
