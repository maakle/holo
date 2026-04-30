import { holoError, ErrorCode } from '@holo/errors';

export interface GrainRecording {
  id: string;
  title: string;
  started_at: string;
  duration_ms: number;
  participants: Array<{ name: string; email?: string }>;
  summary?: string;
  updated_at: string;
}

export interface GrainTranscriptTurn {
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
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
  const base = 'https://api.grain.com/v1';

  async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${base}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
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
      const params: Record<string, string> = {};
      if (opts.updatedAfter) params['updated_after'] = opts.updatedAfter;
      if (opts.cursor) params['cursor'] = opts.cursor;
      const raw = await apiFetch<{
        recordings: GrainRecording[];
        next_cursor?: string;
      }>('/recordings', params);
      return { recordings: raw.recordings ?? [], nextCursor: raw.next_cursor };
    },

    async getTranscript(recordingId) {
      const raw = await apiFetch<{ turns: GrainTranscriptTurn[] }>(
        `/recordings/${recordingId}/transcript`,
      );
      return raw.turns ?? [];
    },
  };
}
