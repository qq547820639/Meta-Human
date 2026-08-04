import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest does not enable `globals`, so RTL's auto-registered cleanup hook is
// not installed. Register it explicitly so rendered DOM does not leak between
// tests within a file (which would otherwise make getByRole ambiguous).
afterEach(() => {
  cleanup();
});
