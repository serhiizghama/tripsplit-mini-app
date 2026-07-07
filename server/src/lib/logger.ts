/**
 * Structured logging via pino.
 *
 * Hard rule: never log secrets or PII — no BOT_TOKEN, no raw `initDataRaw`,
 * no Authorization header values. Log the parsed/derived facts you need
 * (e.g. a user id) instead of the raw signed payload.
 */
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Quiet during tests so vitest output stays readable.
  enabled: !process.env.VITEST,
});
