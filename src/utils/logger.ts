import { writeSync } from "node:fs";
import { format } from "node:util";
import { getServerTimestamp } from "./server-timestamp.js";

export type LogArguments = readonly unknown[];

const formatMessage = (message: string): string =>
  `${process.pid} - [${getServerTimestamp()}] ${message}`;

/** Centralizes process-prefixed logging for bot runtime and deployment messages. */
export const logger = {
  /** Writes an informational message to the console. */
  log: (message: string, ...additionalArguments: LogArguments): void => {
    console.log(formatMessage(message), ...additionalArguments);
  },
  /** Writes a warning message to the console. */
  warn: (message: string, ...additionalArguments: LogArguments): void => {
    console.warn(formatMessage(message), ...additionalArguments);
  },
  /** Writes an error message to the console. */
  error: (message: string, ...additionalArguments: LogArguments): void => {
    console.error(formatMessage(message), ...additionalArguments);
  },
  /** Must remain synchronous: fatal callers exit immediately after this write. */
  fatal: (message: string, ...additionalArguments: LogArguments): void => {
    writeSync(
      process.stderr.fd,
      `${format(formatMessage(message), ...additionalArguments)}\n`,
    );
  },
};
