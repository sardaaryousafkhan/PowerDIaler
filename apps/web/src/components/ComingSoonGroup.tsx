import type { ReactElement } from "react";

export type ComingSoonItem = {
  label: string;
  reason: string;
};

/**
 * One expandable "Coming soon" disclosure per section.
 * Summary is focusable/expandable. Children are inert list items (no handlers).
 */
export function ComingSoonGroup({
  items,
  tooltip = "Not yet supported — coming soon.",
}: {
  items: ComingSoonItem[];
  tooltip?: string;
}): ReactElement | null {
  if (!items.length) return null;
  return (
    <details className="coming-soon-group">
      <summary
        className="coming-soon-group__summary"
        title={tooltip}
        aria-label={`Coming soon. ${tooltip}`}
      >
        Coming soon
        <span className="coming-soon-group__count" aria-hidden>
          {items.length}
        </span>
      </summary>
      <ul className="coming-soon-group__list" role="list">
        {items.map((item) => (
          <li
            key={item.label}
            className="coming-soon-group__item"
            aria-disabled="true"
            title={item.reason}
          >
            <span className="coming-soon-group__item-label">{item.label}</span>
            <span className="coming-soon-group__item-reason">{item.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
