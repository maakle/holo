import type { Hono } from 'hono';
import { loadTeamsBotAccessToken } from '@holo/connectors';
import { logger } from '../logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any, any, any>;

interface MountHealthzOptions {
  appId: string | undefined;
  appSecret: string | undefined;
}

interface HealthzReport {
  appId: 'set' | 'unset';
  appSecret: 'set' | 'unset';
  tokenExchange: 'skipped' | 'ok' | 'failed';
  tokenExchangeError: string | null;
}

/**
 * Operator-facing health endpoint for the shared Microsoft Teams bot. No
 * auth — deliberately public, like other /healthz endpoints. Reports
 * whether env is configured and whether the App ID + secret can mint a
 * Bot Framework token against
 * `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`.
 *
 * Mounted at GET /teams-bot/healthz. Use from the dashboard's "Verify
 * deployment" button — or curl from a deploy script. Never exposes the
 * client secret in the response.
 */
export function mountTeamsBotHealthz(
  app: AnyHono,
  opts: MountHealthzOptions,
): void {
  app.get('/teams-bot/healthz', async (c) => {
    const report: HealthzReport = {
      appId: opts.appId ? 'set' : 'unset',
      appSecret: opts.appSecret ? 'set' : 'unset',
      tokenExchange: 'skipped',
      tokenExchangeError: null,
    };

    if (!opts.appId || !opts.appSecret) {
      return c.json(report, 200);
    }

    // Probe by minting a real Bot Framework token. This proves:
    //   - the Azure AD app registration exists and is enabled
    //   - the client secret is current (not rotated/expired)
    //   - the app has the Microsoft Bot identity permission granted
    // Any failure mode (disabled app, expired secret, wrong tenant)
    // funnels here.
    try {
      const token = await loadTeamsBotAccessToken({
        appId: opts.appId,
        appSecret: opts.appSecret,
      });
      report.tokenExchange = 'ok';
      // Suppress unused-var lint
      void token;
    } catch (err) {
      logger.warn({ err }, 'teams-bot healthz: token mint failed');
      const msg =
        err && typeof err === 'object' && 'problem' in err
          ? String((err as { problem: unknown }).problem)
          : err instanceof Error
            ? err.message
            : 'unknown';
      report.tokenExchange = 'failed';
      report.tokenExchangeError = msg;
    }

    return c.json(report, 200);
  });
}
