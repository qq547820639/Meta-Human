import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";

describe("App", () => {
  it("shows the studio preparation heading", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "正在准备工作室" }),
    ).toBeInTheDocument();
  });
});
