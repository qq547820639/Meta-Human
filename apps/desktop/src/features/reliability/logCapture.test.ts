import { describe, expect, it } from "vitest";

import { createLogCapture } from "./logCapture";

describe("createLogCapture", () => {
  it("appends lines with their stream tag", () => {
    const capture = createLogCapture();
    capture.append("hello", "stdout");
    capture.append("boom", "stderr");

    const lines = capture.lines();
    expect(lines).toEqual([
      { line: "hello", stream: "stdout" },
      { line: "boom", stream: "stderr" },
    ]);
  });

  it("defaults the stream to stdout", () => {
    const capture = createLogCapture();
    capture.append("plain");
    expect(capture.lines()[0].stream).toBe("stdout");
  });

  it("rolls off the oldest lines over maxLines", () => {
    const capture = createLogCapture({ maxLines: 3 });
    capture.append("a");
    capture.append("b");
    capture.append("c");
    capture.append("d");

    expect(capture.lines().map((e) => e.line)).toEqual(["b", "c", "d"]);
  });

  it("tracks the byte size including a newline per line", () => {
    const capture = createLogCapture();
    capture.append("abc"); // 3 + 1 = 4
    capture.append("xy"); // 2 + 1 = 3
    expect(capture.sizeBytes()).toBe(7);
  });

  it("rolls off lines over the byte budget", () => {
    const capture = createLogCapture({ maxBytes: 6 }); // fits "abc\n" (4) + "xy\n" (3) = 7 > 6
    capture.append("abc");
    capture.append("xy");
    // After prune, only "xy" (3 bytes) should remain.
    expect(capture.lines().map((e) => e.line)).toEqual(["xy"]);
    expect(capture.sizeBytes()).toBe(3);
  });

  it("truncate clears all lines and resets bytes", () => {
    const capture = createLogCapture();
    capture.append("a");
    capture.append("b");
    capture.truncate();

    expect(capture.lines()).toEqual([]);
    expect(capture.sizeBytes()).toBe(0);
  });
});