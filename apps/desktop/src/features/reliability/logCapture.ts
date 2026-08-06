/**
 * Bounded, rolling capture of sidecar process output (stdout / stderr).
 *
 * The sidecar can emit a lot of output; keeping every line in memory would
 * leak on a long-running session. This module is a pure, injected buffer that
 * appends lines tagged with their stream, automatically rolling off the oldest
 * lines once either the line count or total byte budget is exceeded, and
 * reports the exact byte size so a diagnostic export can show how much was kept.
 *
 * No timers, no I/O, and no browser APIs — safe in jsdom and unit tests.
 */

export type LogStream = "stdout" | "stderr";

export interface LogEntry {
  readonly line: string;
  readonly stream: LogStream;
}

export interface LogCapture {
  /** Append a line (tagged with its stream). Rolls off oldest lines as needed. */
  append(line: string, stream?: LogStream): void;
  /** A snapshot of the currently retained lines, oldest first. */
  lines(): readonly LogEntry[];
  /** Total bytes of retained data (sum of line lengths + newline per line). */
  sizeBytes(): number;
  /** Drop all retained lines and reset the byte counter. */
  truncate(): void;
}

export interface LogCaptureOptions {
  /** Maximum number of retained lines before rolling off the oldest. Default 1000. */
  readonly maxLines?: number;
  /** Maximum total bytes before rolling off the oldest. Default 64 KiB. */
  readonly maxBytes?: number;
}

export function createLogCapture(options: LogCaptureOptions = {}): LogCapture {
  const maxLines = options.maxLines ?? 1000;
  const maxBytes = options.maxBytes ?? 64 * 1024;
  const entries: LogEntry[] = [];
  let bytes = 0;

  function prune(): void {
    while (
      entries.length > 0 &&
      (entries.length > maxLines || bytes > maxBytes)
    ) {
      const oldest = entries.shift();
      if (oldest) {
        bytes -= oldest.line.length + 1;
      }
    }
  }

  return {
    append(line, stream = "stdout") {
      entries.push({ line, stream });
      bytes += line.length + 1; // +1 for the trailing newline
      prune();
    },
    lines() {
      return entries.map((entry) => ({ ...entry }));
    },
    sizeBytes() {
      return bytes;
    },
    truncate() {
      entries.length = 0;
      bytes = 0;
    },
  };
}