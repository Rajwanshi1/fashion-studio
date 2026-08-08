import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  label: ReactNode;
  /** Mobile card label — required when `label` isn't a plain string (e.g. a JSX checkbox). */
  dataLabel?: string;
  align?: 'right';
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
  onRowClick?: (row: T) => void;
}

export default function DataTable<T>({ columns, rows, rowKey, empty, onRowClick }: Props<T>) {
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
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'rowlink' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={col.align === 'right' ? 'num' : undefined}
                  data-label={col.dataLabel ?? (typeof col.label === 'string' ? col.label : '')}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
