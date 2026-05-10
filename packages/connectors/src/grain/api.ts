/**
 * Grain API helpers built on the framework's HttpClient.
 *
 * Grain requires a `Public-Api-Version` header on every call; the spec
 * sets it via `http.defaultHeaders` so callers here don't need to pass it.
 */
import type { HttpClient } from '@holo/connector-framework';
import type {
  GrainRecording,
  GrainRecordingsPage,
  GrainTranscriptTurn,
} from './types';

const RECORDINGS_PATH = '/_/public-api/v2/recordings';

/**
 * One page of `/recordings` (POST). The Grain v2 schema accepts only `cursor`
 * (opaque pagination token) and `include` (response shape selector); it
 * rejects any other property. Incremental filtering is applied client-side
 * by the caller.
 */
export async function listRecordings(
  api: HttpClient,
  opts: {
    cursor?: string;
    include?: Record<string, boolean>;
  },
): Promise<{ recordings: GrainRecording[]; nextCursor?: string }> {
  const body: Record<string, unknown> = {
    include: opts.include ?? { ai_summary: true, participants: true },
  };
  if (opts.cursor) body['cursor'] = opts.cursor;
  const raw = await api.post<GrainRecordingsPage>(RECORDINGS_PATH, body);
  return {
    recordings: raw.recordings ?? [],
    nextCursor: raw.cursor ?? undefined,
  };
}

export async function getTranscript(
  api: HttpClient,
  recordingId: string,
): Promise<GrainTranscriptTurn[]> {
  const turns = await api.get<GrainTranscriptTurn[]>(
    `${RECORDINGS_PATH}/${recordingId}/transcript`,
  );
  return turns ?? [];
}
