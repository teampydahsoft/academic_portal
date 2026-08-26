import { cn } from "@/lib/cn";

type Props = {
  status: string;
};

const styles: Record<string, string> = {
  Active: "bg-blue-50 text-info",
  Inactive: "bg-slate-100 text-slate-700",
  Regular: "bg-green-50 text-success",
  "Course Completed": "bg-slate-100 text-slate-700",
  "Admission Cancelled": "bg-red-50 text-critical",
  Detained: "bg-amber-50 text-warning",
  Discontinued: "bg-red-50 text-critical",
  "Long Absent": "bg-amber-50 text-warning",
  "Re-Joined": "bg-blue-50 text-info",
  Rejoined: "bg-blue-50 text-info",
  Published: "bg-green-50 text-success",
  Draft: "bg-slate-100 text-slate-700",
  Balanced: "bg-green-50 text-success",
  Overloaded: "bg-red-50 text-critical",
  Underloaded: "bg-amber-50 text-warning",
  Critical: "bg-red-50 text-critical",
  High: "bg-amber-50 text-warning",
  Medium: "bg-blue-50 text-info",
  Low: "bg-green-50 text-success",
  Open: "bg-amber-50 text-warning",
  Closed: "bg-green-50 text-success",
  Pending: "bg-amber-50 text-warning",
  Posted: "bg-green-50 text-success",
  Paid: "bg-green-50 text-success",
  Pass: "bg-green-50 text-success",
  Fail: "bg-red-50 text-critical",
  Supply: "bg-amber-50 text-warning",
};

function titleCase(value: string) {
  if (!value) return value;
  return value
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function StatusBadge({ status }: Props) {
  const label = titleCase(status);
  const style =
    styles[status] ??
    styles[label] ??
    Object.entries(styles).find(([key]) => key.toLowerCase() === status.toLowerCase())?.[1] ??
    "bg-slate-100 text-slate-700";

  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", style)}>
      {label || status}
    </span>
  );
}
