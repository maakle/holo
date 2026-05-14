/**
 * Microsoft Teams Bot Connector outbound API client.
 *
 * Posts and updates activities by hitting the per-request `serviceUrl`
 * captured from inbound traffic. Microsoft warns that the URL is
 * region-specific and may change, so we never normalize it (no trailing
 * slash trimming, no host rewriting).
 *
 * Endpoint patterns (REST API 3.0):
 *   POST {serviceUrl}/v3/conversations/{conversationId}/activities
 *   PUT  {serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}
 */
import type {
  TeamsSendActivityInput,
  TeamsSendActivityResult,
  TeamsUpdateActivityInput,
  TeamsUpdateActivityResult,
} from './app-types';
import { loadTeamsBotAccessToken } from './app-auth';

export interface TeamsBotApiClient {
  sendActivity(input: TeamsSendActivityInput): Promise<TeamsSendActivityResult>;
  updateActivity(input: TeamsUpdateActivityInput): Promise<TeamsUpdateActivityResult>;
}

interface ClientOptions {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
}

export function createTeamsBotApiClient(opts: ClientOptions): TeamsBotApiClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function authedFetch(
    method: 'POST' | 'PUT',
    url: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const { accessToken } = await loadTeamsBotAccessToken({
      appId: opts.appId,
      appSecret: opts.appSecret,
      fetchImpl,
    });
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      // Bot Connector returns empty body on PUT success — leave json={}.
    }
    return { ok: res.ok, status: res.status, json };
  }

  return {
    async sendActivity(input) {
      const url = `${input.serviceUrl}v3/conversations/${encodeURIComponent(input.conversationId)}/activities`;
      const { ok, json } = await authedFetch('POST', url, input.body);
      if (!ok) {
        return { ok: false, error: extractError(json) ?? 'send_activity_failed' };
      }
      const activityId =
        typeof json['id'] === 'string' ? (json['id'] as string) : undefined;
      return { ok: true, ...(activityId !== undefined ? { activityId } : {}) };
    },

    async updateActivity(input) {
      const url = `${input.serviceUrl}v3/conversations/${encodeURIComponent(input.conversationId)}/activities/${encodeURIComponent(input.activityId)}`;
      const { ok, json } = await authedFetch('PUT', url, input.body);
      if (!ok) {
        return { ok: false, error: extractError(json) ?? 'update_activity_failed' };
      }
      return { ok: true };
    },
  };
}

function extractError(json: Record<string, unknown>): string | undefined {
  const err = json['error'];
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  if (typeof err === 'string') return err;
  return undefined;
}
