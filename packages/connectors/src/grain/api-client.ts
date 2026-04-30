import { holoError, ErrorCode } from '@holo/errors';

export interface GrainRecording {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  duration_ms: number;
  url: string;
  thumbnail_url?: string;
  source: string;
  media_type: string;
  tags: string[];
  teams: string[];
  participants?: Array<{
    id: string;
    name: string;
    email: string | null;
    scope: string;
    confirmed_attendee: boolean;
  }>;
  ai_summary?: {
    text: string;
  };
}

export interface GrainTranscriptTurn {
  speaker: string;
  start: number;
  end: number;
  text: string;
  participant_id: string | null;
}

export interface GrainApiClient {
  listRecordings(opts: { updatedAfter?: string; cursor?: string }): Promise<{
    recordings: GrainRecording[];
    nextCursor?: string;
  }>;
  getTranscript(recordingId: string): Promise<GrainTranscriptTurn[]>;
}

export function createGrainApiClient(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): GrainApiClient {
  const base = 'https://api.grain.com';

  async function apiFetch<T>(
    path: string,
    options?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = `${base}${path}`;
    const res = await fetchImpl(url, {
      method: options?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Public-Api-Version': '2025-10-31',
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!res.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Grain API error ${res.status} at ${path}`,
        fix: 'Verify the Grain access token and that the requested resource exists.',
      });
    }
    return res.json() as Promise<T>;
  }

  return {
    async listRecordings(opts) {
      const body: Record<string, unknown> = {
        include: { ai_summary: true, participants: true },
      };
      if (opts.updatedAfter) body['after_datetime'] = opts.updatedAfter;
      if (opts.cursor) body['cursor'] = opts.cursor;
      const raw = await apiFetch<{
        recordings: GrainRecording[];
        cursor: string | null;
      }>('/_/public-api/v2/recordings', { method: 'POST', body });
      return { recordings: raw.recordings ?? [], nextCursor: raw.cursor ?? undefined };
    },

    async getTranscript(recordingId) {
      const turns = await apiFetch<GrainTranscriptTurn[]>(
        `/_/public-api/v2/recordings/${recordingId}/transcript`,
      );
      return turns ?? [];
    },
  };
}
