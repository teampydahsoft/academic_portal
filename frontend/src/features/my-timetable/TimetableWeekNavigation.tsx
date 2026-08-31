"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatWeekRange } from "./utils";

type Props = {
  weekLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  isCurrentWeek: boolean;
};

export function TimetableWeekNavigation({
  weekLabel,
  onPrevious,
  onNext,
  onToday,
  isCurrentWeek,
}: Props) {
  return (
    <nav
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-4"
      aria-label="Week navigation"
    >
      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onPrevious}
          aria-label="Previous week"
          className="min-h-10 flex-1 sm:min-h-0 sm:flex-none"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Previous week</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onNext}
          aria-label="Next week"
          className="min-h-10 flex-1 sm:min-h-0 sm:flex-none"
        >
          <span className="truncate">Next week</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </Button>
      </div>

      <p
        className="text-center text-sm font-semibold text-navy-900 sm:text-left"
        aria-live="polite"
      >
        {weekLabel}
      </p>

      <div className="flex justify-center sm:justify-end">
        <Button
          type="button"
          size="sm"
          variant={isCurrentWeek ? "primary" : "secondary"}
          onClick={onToday}
          disabled={isCurrentWeek}
          aria-label="Go to current week"
          className="min-h-10 w-full sm:w-auto"
        >
          Today
        </Button>
      </div>
    </nav>
  );
}

export function formatNavigationWeekLabel(start: Date, end: Date) {
  return formatWeekRange(start, end);
}
