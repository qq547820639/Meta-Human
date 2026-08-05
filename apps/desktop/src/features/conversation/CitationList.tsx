import type { Citation } from "./conversationClient";

interface CitationListProps {
  readonly citations: readonly Citation[];
  readonly grounded: boolean;
  /** True when the reply had no reliable knowledge source to ground on. */
  readonly noBasis?: boolean;
}

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Displays the structured citations for a grounded reply, with the source
 * title, type, updated time, snippet and a link to open the original. When a
 * reply has no reliable knowledge basis it shows an explicit "未使用知识库"
 * marker instead.
 */
export default function CitationList({
  citations,
  grounded,
  noBasis = false,
}: CitationListProps) {
  if (noBasis) {
    return (
      <p className="conversation-citation conversation-citation-no-basis">
        未使用知识库
      </p>
    );
  }
  if (citations.length === 0) {
    return grounded ? null : (
      <p className="conversation-citation">这条回答没有引用本地知识。</p>
    );
  }
  return (
    <ol className="conversation-citation-list" aria-label="来源">
      {citations.map((citation) => (
        <li key={citation.id} className="conversation-citation-item">
          <span className="conversation-citation-heading">
            {citation.url ? (
              <a href={citation.url} target="_blank" rel="noreferrer">
                {citation.title}
              </a>
            ) : (
              <span className="conversation-citation-title">
                {citation.title}
              </span>
            )}
            <span className="conversation-citation-type">{citation.type}</span>
          </span>
          {citation.sourceUrl ? (
            <span className="conversation-citation-source">
              来源：{citation.sourceUrl}
            </span>
          ) : null}
          {formatUpdatedAt(citation.updatedAt) ? (
            <span className="conversation-citation-updated">
              更新于 {formatUpdatedAt(citation.updatedAt)}
            </span>
          ) : null}
          {citation.snippet ? (
            <p className="conversation-citation-snippet">
              {citation.snippet}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
