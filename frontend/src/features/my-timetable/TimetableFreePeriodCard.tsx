import type { TimetablePeriod } from "./types";
import { formatTime12h } from "./utils";

type Props = {
  period: Extract<TimetablePeriod, { kind: "free" }>;
};

export function TimetableFreePeriodCard({ period }: Props) {
  return (
    <div
      className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2.5"
      aria-label={`Free period ${period.startTime} to ${period.endTime}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        Free period
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {formatTime12h(period.startTime)} – {formatTime12h(period.endTime)}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">No class scheduled</p>
    </div>
  );
}
