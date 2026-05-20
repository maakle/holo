import type { ErrorCodeValue } from './codes';

export interface HoloErrorInput {
  code: ErrorCodeValue;
  problem: string;
  cause?: string;
  fix: string;
  docs_url?: string;
  /** Optional structured payload that travels with the error to the client.
   *  Used by code paths (e.g. `HOLO_PLAN_LIMIT_REACHED`) that need to render
   *  more than the standard problem+fix copy — the upgrade modal reads
   *  current plan / limit / suggested upgrade target from here. Stay
   *  serialisable: JSON-encoded into `toJSON()`. */
  meta?: Record<string, unknown>;
}

export class HoloError extends Error {
  readonly code: ErrorCodeValue;
  readonly problem: string;
  override readonly cause?: string;
  readonly fix: string;
  readonly docs_url?: string;
  readonly meta?: Record<string, unknown>;

  constructor(input: HoloErrorInput) {
    super(`${input.code}: ${input.problem}`);
    this.name = 'HoloError';
    this.code = input.code;
    this.problem = input.problem;
    this.cause = input.cause;
    this.fix = input.fix;
    this.docs_url = input.docs_url;
    this.meta = input.meta;
  }

  toJSON() {
    return {
      code: this.code,
      problem: this.problem,
      ...(this.cause !== undefined && { cause: this.cause }),
      fix: this.fix,
      ...(this.docs_url !== undefined && { docs_url: this.docs_url }),
      ...(this.meta !== undefined && { meta: this.meta }),
    };
  }
}

export function holoError(input: HoloErrorInput): HoloError {
  return new HoloError(input);
}

export { ErrorCode } from './codes';
export type { ErrorCodeValue } from './codes';
