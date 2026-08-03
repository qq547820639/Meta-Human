import type { Citation } from "./conversationClient";

interface CitationListProps {
  readonly citations: readonly Citation[];
  readonly grounded: boolean;
}

/**
 * Displays the structured citations for a grounded reply, with the source
 * title, type, snippet and a link to open the original.
 */
export default function CitationList({
  citations,
  grounded,
}: CitationListProps) {
  if (citations.length === 0) {
    return grounded ? null : (
      <p className="conversation-citation">这条回答没有引用本地知识。</p>
    );
  }
  return (
    <ol className="conversation-citation-list" aria-label="来源">
      {citations.map((citation) => (
        <li key={citation.id} className="conversation-citation-item">
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