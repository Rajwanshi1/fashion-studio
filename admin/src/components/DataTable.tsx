import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  align?: 'right';
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
  onRowClick?: (row: T) => void;
  /** When provided, clicking a row toggles an expanded detail row beneath it. */
  renderExpanded?: (row: T) => ReactNode;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  renderExpanded,
}: Props<T>) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const clickable = Boolean(onRowClick || renderExpanded);

  const handleRow = (row: T) => {
    if (renderExpanded) {
      const key = rowKey(row);
      setExpandedKey((cur) => (cur === key ? null : key));
    }
    onRowClick?.(row);
  };

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.align === 'right' ? 'num' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <Fragment key={key}>
                <tr
                  className={clickable ? 'rowlink' : undefined}
                  onClick={clickable ? () => handleRow(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={col.align === 'right' ? 'num' : undefined}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
                {renderExpanded && expandedKey === key && (
                  <tr className="detail">
                    <td colSpan={columns.length}>{renderExpanded(row)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
