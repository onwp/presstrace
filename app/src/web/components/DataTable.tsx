import { useMemo, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Present when the column can be sorted. */
  sort?: (row: T) => number | string;
  numeric?: boolean;
  className?: string;
}

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  pageSize?: number;
  /** Called when a row is activated by click; the first cell should also hold a focusable control. */
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}

/**
 * A semantic table that scrolls horizontally inside its card on narrow screens.
 * Shows the first rows with a "Show more" button.
 */
export function DataTable<T>({ caption, columns, rows, rowKey, initialSort, pageSize = 10, onRowClick, empty }: Props<T>) {
  const [sort, setSort] = useState(initialSort);
  const [visible, setVisible] = useState(pageSize);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    const get = col.sort;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0 && empty) return <>{empty}</>;
  const shown = sorted.slice(0, visible);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`px-3 py-2 font-semibold whitespace-nowrap text-muted ${c.numeric ? "text-right" : ""}`}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        className={`inline-flex min-h-10 items-center gap-1 rounded hover:text-fg ${active ? "text-fg" : ""}`}
                        onClick={() =>
                          setSort({ key: c.key, dir: active && sort.dir === "desc" ? "asc" : "desc" })
                        }
                      >
                        {c.header}
                        <span aria-hidden="true" className="w-3 text-xs">
                          {active ? (sort.dir === "desc" ? "↓" : "↑") : ""}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-line last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-surface-2" : ""}`}
                onClick={
                  onRowClick
                    ? (e) => {
                        // Let real links and buttons inside the row do their own thing.
                        if ((e.target as HTMLElement).closest("a,button")) return;
                        onRowClick(row);
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 align-middle ${c.numeric ? "text-right tabular-nums whitespace-nowrap" : ""} ${c.className ?? ""}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm text-muted">
          <span>
            Showing {shown.length} of {sorted.length}
          </span>
          <div className="flex gap-2">
            {visible < sorted.length && (
              <button type="button" className="btn" onClick={() => setVisible((v) => v + pageSize * 2)}>
                Show more
              </button>
            )}
            {visible > pageSize && (
              <button type="button" className="btn" onClick={() => setVisible(pageSize)}>
                Show less
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The focusable first-cell control that opens a row's detail. */
export function RowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  // No aria-label: the accessible name is the visible text (WCAG 2.5.3 Label in Name); the hint is appended.
  return (
    <button type="button" onClick={onClick} className="link relative min-h-10 max-w-full text-left break-words">
      {children}
      <span className="sr-only">, show samples</span>
    </button>
  );
}
