import { cn } from "@/lib/cn";

type Props = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "critical" | "info";
  onClickHref?: string;
};

const toneMap = {
  default: "border-border",
  success: "border-green-200",
  warning: "border-amber-200",
  critical: "border-red-200",
  info: "border-blue-200",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: Props) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm",
        toneMap[tone],
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-navy-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
