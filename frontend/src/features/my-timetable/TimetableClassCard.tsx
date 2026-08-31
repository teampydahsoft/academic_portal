import { cn } from "@/lib/cn";
import type { TimetablePeriod } from "./types";
import { buildCourseSectionLine, entryTypeLabel, formatTime12h } from "./utils";

type Props = {
  period: Extract<TimetablePeriod, { kind: "class" }>;
  compact?: boolean;
};

export function TimetableClassCard({ period, compact = false }: Props) {
  const entryLabel = entryTypeLabel(period.entryType);
  const isLab = period.entryType.toLowerCase() === "lab";
  const subject = period.subjectName ?? period.subjectCode ?? "Untitled subject";
  const contextLine = buildCourseSectionLine(period);

  return (
    <article
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
      aria-label={`${subject}, ${formatTime12h(period.startTime)} to ${formatTime12h(period.endTime)}`}
    >
      <h4
        className={cn(
          "break-words font-semibold leading-snug text-navy-900",
          compact ? "text-sm" : "text-base",
        )}
      >
        {subject}
      </h4>

      <p className="mt-1.5 text-xs font-medium text-slate-600">
        {formatTime12h(period.startTime)} – {formatTime12h(period.endTime)}
        {period.slotLabel ? (
          <span className="font-normal text-slate-400"> • {period.slotLabel}</span>
        ) : null}
      </p>

      {contextLine ? (
        <p className="mt-2 break-words text-xs text-slate-600">{contextLine}</p>
      ) : null}

      {period.collegeName ? (
        <p className="mt-1 break-words text-xs text-slate-500">{period.collegeName}</p>
      ) : null}

      {period.roomLabel ? (
        <p className="mt-2 break-words text-xs text-slate-500">
          Room: <span className="font-medium text-slate-600">{period.roomLabel}</span>
        </p>
      ) : null}

      <div className="mt-3">
        <span
          className={cn(
            "inline-flex rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isLab ? "bg-teal-50 text-teal-700" : "bg-brand-50 text-brand-700",
          )}
        >
          {entryLabel}
        </span>
      </div>
    </article>
  );
}
