import { Card } from "@/components/ui/Card";

export function RequestListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      <div className="hidden overflow-hidden rounded-lg border border-border bg-white md:block">
        <div className="grid grid-cols-6 gap-3 border-b border-border bg-slate-50 px-4 py-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-3 rounded bg-slate-200" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="grid grid-cols-6 gap-3 border-b border-border px-4 py-4 last:border-0">
            {Array.from({ length: 6 }).map((_, col) => (
              <div key={col} className="h-4 rounded bg-slate-100" />
            ))}
          </div>
        ))}
      </div>
      <div className="space-y-3 md:hidden">
        {Array.from({ length: rows }).map((_, index) => (
          <Card key={index}>
            <div className="space-y-2">
              <div className="h-3 w-24 rounded bg-slate-200" />
              <div className="h-5 w-3/4 rounded bg-slate-200" />
              <div className="h-3 w-full rounded bg-slate-100" />
              <div className="h-3 w-1/2 rounded bg-slate-100" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function RequestDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <Card>
        <div className="mb-4 flex gap-2">
          <div className="h-6 w-20 rounded bg-slate-200" />
          <div className="h-6 w-28 rounded bg-slate-100" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="h-3 w-20 rounded bg-slate-200" />
              <div className="h-4 w-full rounded bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <div className="h-3 w-24 rounded bg-slate-200" />
          <div className="h-16 w-full rounded bg-slate-100" />
        </div>
      </Card>
      <Card>
        <div className="mb-3 h-4 w-32 rounded bg-slate-200" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-14 rounded bg-slate-100" />
          ))}
        </div>
      </Card>
    </div>
  );
}
