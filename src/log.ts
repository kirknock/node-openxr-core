/**
 * Channel loggers. Every line keeps the "[channel] message" format that the
 * headset procedure (docs/target-testing.md) greps for — keep channel names
 * stable.
 *
 *   const log = logger("session");      log.info("session begun")  -> "[session] session begun"
 *   const dbg = debugLogger("input", "pose:debug");   silent unless XR_INPUT_DEBUG=1
 *   if (dbg.enabled) { ...expensive diagnostics...; dbg.info(...) }
 *
 * A message starting with "\n" is attached without the separating space
 * ("[timing]\n<table>"). Non-string first arguments are passed through
 * after the tag. Unprefixed machine-readable output (XR_ENV_JSON=...) uses
 * rawLog.
 */
import { xrEnv, type XrEnv } from "./config.js";

export interface Logger {
  readonly enabled: boolean;
  info(message: unknown, ...rest: unknown[]): void;
  warn(message: unknown, ...rest: unknown[]): void;
  error(message: unknown, ...rest: unknown[]): void;
}

type Sink = (...args: unknown[]) => void;

function tagged(tag: string, sink: Sink): (message: unknown, ...rest: unknown[]) => void {
  return (message, ...rest) => {
    if (typeof message === "string") {
      sink(`${tag}${message.startsWith("\n") ? "" : " "}${message}`, ...rest);
    } else {
      sink(tag, message, ...rest);
    }
  };
}

const noop = (): void => {};

export function logger(channel: string): Logger {
  const tag = `[${channel}]`;
  // console.* is looked up per call, not captured: tests and tools that
  // intercept console.log (e.g. controller-log-smoke) must still see lines.
  return {
    enabled: true,
    info: tagged(tag, (...a) => console.log(...a)),
    warn: tagged(tag, (...a) => console.warn(...a)),
    error: tagged(tag, (...a) => console.error(...a)),
  };
}

/** A channel that only logs when the given XR_*_DEBUG flag (config.ts) is on. */
export function debugLogger(flag: keyof XrEnv["debug"], channel: string): Logger {
  // Lazy: config may legitimately be set in a script body after imports.
  let resolved: Logger | null = null;
  const get = (): Logger => (resolved ??= xrEnv().debug[flag] ? logger(channel) : { enabled: false, info: noop, warn: noop, error: noop });
  return {
    get enabled() {
      return get().enabled;
    },
    info: (m, ...r) => get().info(m, ...r),
    warn: (m, ...r) => get().warn(m, ...r),
    error: (m, ...r) => get().error(m, ...r),
  };
}

/** Untagged output (multi-line reports, machine-readable lines). */
export function rawLog(text: string): void {
  console.log(text);
}
