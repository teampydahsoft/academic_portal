import { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function MobileDataCardHeader({
  title,
  status,
  secondary,
}: {
  title: ReactNode;
  status?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 mb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-900 leading-tight min-w-0 flex-1 break-words">
          {title}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>
      {secondary && <div className="text-sm text-slate-500">{secondary}</div>}
    </div>
  );
}

export function MobileDataCardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm text-slate-600">
      {children}
    </div>
  );
}

export function MobileDataCardField({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400 truncate">
        {label}
      </span>
      <span className="font-medium text-slate-900 truncate" title={typeof value === "string" ? value : undefined}>
        {value}
      </span>
    </div>
  );
}

export function MobileDataCardActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
      {children}
    </div>
  );
}
