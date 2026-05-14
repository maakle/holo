/**
 * Google Chat App outbound API client — used by the worker bot to post a
 * placeholder reply and patch it with the agent's answer.
 *
 * Distinct from `./api.ts` (the read-only ingestion client built on the
 * connector framework's HttpClient with a delegated bearer token): the
 * App API uses an app-level service-account token, posts to a different
 * subset of endpoints (`messages.create`, `messages.patch`), and does its
 * own rate-limit handling.
 *
 * Reference: https://developers.google.com/workspace/chat/api/reference/rest
 */
import type {
  GoogleChatCardV2Message,
  GoogleChatCreateMessageInput,
  GoogleChatCreateMessageResult,
  GoogleChatPatchMessageInput,
  GoogleChatPatchMessageResult,
} from './app-types';
import { loadChatAppAccessToken } from './app-auth';

const CHAT_BASE_URL = 'https://chat.googleapis.com/v1';

export interface GoogleChatAppApiClient {
  createMessage(input: GoogleChatCreateMessageInput): Promise<GoogleChatCreateMessageResult>;
  patchMessage(input: GoogleChatPatchMessageInput): Promise<GoogleChatPatchMessageResult>;
}

interface ClientOptions {
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
}

/**
 * Construct an outbound Chat API client. The token is minted on first use
 * (and cached for ~55 minutes) so creating the client is cheap; do it per
 * job rather than holding a long-lived singleton — the SA may rotate.
 */
export function createGoogleChatAppApiClient(
  opts: ClientOptions,
): GoogleChatAppApiClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function authedFetch(
    method: 'POST' | 'PATCH',
    path: string,
    query: Record<string, string>,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const { accessToken } = await loadChatAppAccessToken({
      serviceAccountJson: opts.serviceAccountJson,
      fetchImpl,
    });
    const url = new URL(`${CHAT_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
    const res = await fetchImpl(url.toString(), {
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
      // Non-JSON response surfaces as ok=false with empty body.
    }
    return { ok: res.ok, status: res.status, json };
  }

  return {
    async createMessage(input) {
      const query: Record<string, string> = {};
      if (input.messageReplyOption) {
        query['messageReplyOption'] = input.messageReplyOption;
      }
      const { ok, json } = await authedFetch(
        'POST',
        `/${input.parent}/messages`,
        query,
        sanitizeMessageBody(input.body),
      );
      if (!ok) {
        return {
          ok: false,
          error: extractError(json) ?? 'create_message_failed',
        };
      }
      const name = typeof json['name'] === 'string' ? (json['name'] as string) : undefined;
      const thread =
        json['thread'] && typeof json['thread'] === 'object'
          ? (json['thread'] as { name?: string })
          : undefined;
      return {
        ok: true,
        message: name
          ? {
              name,
              thread: thread?.name ? { name: thread.name } : undefined,
            }
          : undefined,
      };
    },

    async patchMessage(input) {
      // Chat's PATCH uses field masks to declare which fields are being
      // replaced. We always rewrite both `text` and `cardsV2` to keep the
      // placeholder→final transition atomic.
      const { ok, json } = await authedFetch(
        'PATCH',
        `/${input.name}`,
        { updateMask: 'text,cardsV2' },
        sanitizeMessageBody(input.body),
      );
      if (!ok) {
        return {
          ok: false,
          error: extractError(json) ?? 'patch_message_failed',
        };
      }
      const name = typeof json['name'] === 'string' ? (json['name'] as string) : undefined;
      return {
        ok: true,
        message: name ? { name } : undefined,
      };
    },
  };
}

/**
 * Strip undefined fields so the JSON body matches Google's required shape
 * (Cards v2 rejects `cardsV2: undefined`; we want it omitted entirely).
 */
function sanitizeMessageBody(body: GoogleChatCardV2Message): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (body.text !== undefined) out['text'] = body.text;
  if (body.cardsV2 !== undefined) out['cardsV2'] = body.cardsV2;
  if (body.thread !== undefined) out['thread'] = body.thread;
  return out;
}

function extractError(json: Record<string, unknown>): string | undefined {
  const err = json['error'];
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (typeof err === 'string') return err;
  return undefined;
}
