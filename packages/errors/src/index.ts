import type { ErrorCodeValue } from './codes';

export interface HoloErrorInput {
  code: ErrorCodeValue;
  problem: string;
  cause?: string;
  fix: string;
  docs_url?: string;
}

export class HoloError extends Error {
  readonly code: ErrorCodeValue;
  readonly problem: string;
  override readonly cause?: string;
  readonly fix: string;
  readonly docs_url?: string;

  constructor(input: HoloErrorInput) {
    super(`${input.code}: ${input.problem}`);
    this.name = 'HoloError';
    this.code = input.code;
    this.problem = input.problem;
    this.cause = input.cause;
    this.fix = input.fix;
    this.docs_url = input.docs_url;
  }

  toJSON() {
    return {
      code: this.code,
      problem: this.problem,
      ...(this.cause !== undefined && { cause: this.cause }),
      fix: this.fix,
      ...(this.docs_url !== undefined && { docs_url: this.docs_url }),
    };
  }
}

export function holoError(input: HoloErrorInput): HoloError {
  return new HoloError(input);
}

export { ErrorCode } from './codes';
export type { ErrorCodeValue } from './codes';
