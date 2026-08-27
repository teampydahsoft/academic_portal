import { cn } from "@/lib/cn";

export type DataTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  className?: string;
};

type Props<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  mobileRender?: (row: T) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "No records found.",
  onRowClick,
  mobileRender,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  const tableClasses = cn(
    "overflow-x-auto rounded-lg border border-border bg-card",
    mobileRender && "hidden md:block"
  );

  return (
    <>
      {mobileRender && (
        <div className="grid grid-cols-1 gap-3 md:hidden">
          {rows.map((row) => (
            <div
              key={rowKey(row)}
              className={cn(
                "rounded-lg border border-border bg-card p-4 shadow-sm",
                onRowClick && "cursor-pointer hover:bg-slate-50 transition-colors"
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? "button" : undefined}
            >
              {mobileRender(row)}
            </div>
          ))}
        </div>
      )}
      <div className={tableClasses}>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={cn("px-3 py-2.5 font-medium", column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn(
                  "border-b border-border last:border-0 hover:bg-slate-50",
                  onRowClick && "cursor-pointer transition-colors"
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn("px-3 py-2.5 align-middle", column.className)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
