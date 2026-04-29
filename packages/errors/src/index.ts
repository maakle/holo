import type { ErrorCodeValue } from './codes';

export interface MemexErrorInput {
  code: ErrorCodeValue;
  problem: string;
  cause?: string;
  fix: string;
  docs_url?: string;
}

export class MemexError extends Error {
  readonly code: ErrorCodeValue;
  readonly problem: string;
  override readonly cause?: string;
  readonly fix: string;
  readonly docs_url?: string;

  constructor(input: MemexErrorInput) {
    super(`${input.code}: ${input.problem}`);
    this.name = 'MemexError';
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

export function memexError(input: MemexErrorInput): MemexError {
  return new MemexError(input);
}

export { ErrorCode } from './codes';
export type { ErrorCodeValue } from './codes';
