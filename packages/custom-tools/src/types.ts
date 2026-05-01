export interface CustomToolRow {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  command: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  envAllowlist: string[];
  scope: string | null;
  readOnly: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ExpandedInvocation {
  command: string;
  argv: string[];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  durationMs: number;
}
