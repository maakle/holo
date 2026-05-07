/**
 * Grain API response shapes — projected to the fields the spec actually reads.
 */

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
  ai_summary?: { text: string };
}

export interface GrainTranscriptTurn {
  speaker: string;
  start: number;
  end: number;
  text: string;
  participant_id: string | null;
}

export interface GrainRecordingsPage {
  recordings: GrainRecording[];
  cursor: string | null;
}
