import pino from 'pino';

// Reads LOG_LEVEL from process.env directly (the one allowed escape from
// @holo/env in this app) because the logger is imported before main() runs
// parseEnv, and we want logging available during module init / boot failures.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'gateway' },
});
