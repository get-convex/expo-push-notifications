import { v, type Infer } from "convex/values";

export const logLevelValidator = v.union(
  v.literal("DEBUG"),
  v.literal("INFO"),
  v.literal("WARN"),
  v.literal("ERROR"),
);

export type LogLevel = Infer<typeof logLevelValidator>;
const orderedLevels: LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR"];
export const logWithLevel = (
  level: LogLevel,
  configuredLevel: LogLevel,
  ...args: unknown[]
) => {
  if (orderedLevels.indexOf(level) < orderedLevels.indexOf(configuredLevel)) {
    return;
  }
  switch (level) {
    case "DEBUG":
      console.debug(...args);
      break;
    case "INFO":
      console.info(...args);
      break;
    case "WARN":
      console.warn(...args);
      break;
    case "ERROR":
      console.error(...args);
      break;
  }
};

export class Logger {
  constructor(private configuredLevel: LogLevel) {}

  get level() {
    return this.configuredLevel;
  }

  debug(...args: unknown[]) {
    logWithLevel("DEBUG", this.configuredLevel, ...args);
  }

  info(...args: unknown[]) {
    logWithLevel("INFO", this.configuredLevel, ...args);
  }

  warn(...args: unknown[]) {
    logWithLevel("WARN", this.configuredLevel, ...args);
  }

  error(...args: unknown[]) {
    logWithLevel("ERROR", this.configuredLevel, ...args);
  }
}
