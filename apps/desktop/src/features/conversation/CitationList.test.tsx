import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import CitationList from "./CitationList";

afterEach(cleanup);

describe("CitationList", () => {
  it("renders structured citations with a link to the source", () => {
    render(
      <CitationList
        grounded={true}
        citations={[
          {
            id: "src-1",
            title: "项目验收手册",
            type: "doc",
            snippet: "这是一个片段。",
            url: "https://feishu.cn/docx/doc-1",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "项目验收手册" }),
    ).toHaveAttribute("href", "https://feishu.cn/docx/doc-1");
    expect(screen.getByText("doc")).toBeInTheDocument();
    expect(screen.getByText("这是一个片段。")).toBeInTheDocument();
  });

  it("renders a citation without a link when no url is present", () => {
    render(
      <CitationList
        grounded={true}
        citations={[{ id: "src-2", title: "本地来源", type: "file" }]}
      />,
    );

    expect(screen.getByText("本地来源")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows an honest note when a reply is not grounded", () => {
    render(<CitationList grounded={false} citations={[]} />);

    expect(
      screen.getByText("这条回答没有引用本地知识。"),
    ).toBeInTheDocument();
  });

  it("renders nothing when grounded with no citations", () => {
    const { container } = render(
      <CitationList grounded={true} citations={[]} />,
    );

    expect(container.firstChild).toBeNull();
  });
});