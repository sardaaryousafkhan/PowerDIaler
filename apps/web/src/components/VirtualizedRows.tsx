import { useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

const ROW_H = 56;
const OVERSCAN = 6;
const VIEWPORT_CAP = 20; // ~20 visible rows target

/**
 * Windowed list — DOM node count stays ~VIEWPORT_CAP + overscan regardless of dataset size.
 */
export function VirtualizedRows<T>({
  items,
  getKey,
  renderRow,
  className,
  role = "list",
}: {
  items: T[];
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
  role?: string;
}): ReactElement {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const viewportH = VIEWPORT_CAP * ROW_H;

  const { start, end, offsetY, totalH } = useMemo(() => {
    const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
    const visible = Math.ceil(viewportH / ROW_H) + OVERSCAN * 2;
    const endIdx = Math.min(items.length, startIdx + visible);
    return {
      start: startIdx,
      end: endIdx,
      offsetY: startIdx * ROW_H,
      totalH: items.length * ROW_H,
    };
  }, [items.length, scrollTop, viewportH]);

  const slice = items.slice(start, end);

  return (
    <div
      ref={scrollerRef}
      className={className}
      role={role}
      data-virtualized="true"
      data-item-count={items.length}
      data-dom-rows={slice.length}
      style={{ maxHeight: viewportH, height: viewportH, overflowY: "auto", position: "relative" }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalH, position: "relative", width: "100%" }}>
        <div style={{ transform: `translate3d(0, ${offsetY}px, 0)`, willChange: "transform" } as CSSProperties}>
          {slice.map((item, i) => (
            <div key={getKey(item, start + i)} style={{ height: ROW_H, boxSizing: "border-box" }}>
              {renderRow(item, start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
