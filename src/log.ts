// Primitive values only: callers cannot pass objects or Error instances,
// so transcript text, secrets and URLs are never logged by accident.
export type LogData = Record<string, string | number | boolean | null>;

export interface Logger {
  info(event: string, data?: LogData): void;
  error(event: string, data?: LogData): void;
}

export const logger: Logger = {
  info(event, data) {
    process.stdout.write(`${JSON.stringify({ ...data, level: 'info', event })}\n`);
  },
  error(event, data) {
    process.stderr.write(`${JSON.stringify({ ...data, level: 'error', event })}\n`);
  },
};
