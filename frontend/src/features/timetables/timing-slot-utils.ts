export type TimingSlotLike = {
  slotType: string;
  label: string;
  isAssignable?: boolean;
  startTime?: string;
  endTime?: string;
};

function slotMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return end > start ? end - start : 0;
}

export function isNonClassTimingSlot(slot: TimingSlotLike): boolean {
  return (
    slot.isAssignable === false ||
    slot.slotType === "BREAK" ||
    slot.slotType === "LUNCH" ||
    slot.slotType === "ACTIVITY" ||
    slot.slotType === "OTHER"
  );
}

export function timingSlotDisplayLabel(slot: TimingSlotLike): string {
  const label = slot.label?.trim() || "";
  const lower = label.toLowerCase();

  if (slot.slotType === "LUNCH" || lower.includes("lunch")) return "Lunch Break";
  if (slot.slotType === "BREAK" || lower.includes("break") || lower.includes("tea")) {
    return "Break";
  }
  if (slot.slotType === "ACTIVITY") return label || "Activity";
  if (slot.slotType === "OTHER") return label || "Other";

  if (isNonClassTimingSlot(slot)) {
    if (slot.startTime && slot.endTime) {
      const minutes = slotMinutes(slot.startTime, slot.endTime);
      if (minutes >= 45) return "Lunch Break";
    }
    return "Break";
  }

  return label || "Period";
}

export function timingSlotCellClass(slot: TimingSlotLike): string {
  const display = timingSlotDisplayLabel(slot);
  if (display === "Lunch Break") {
    return "bg-orange-50 text-orange-900 border border-orange-200";
  }
  if (display === "Break") {
    return "bg-slate-100 text-slate-600 border border-slate-200";
  }
  switch (slot.slotType) {
    case "ACTIVITY":
      return "bg-emerald-50 text-emerald-900 border border-emerald-200";
    case "OTHER":
      return "bg-slate-100 text-slate-600 border border-slate-200";
    default:
      return "bg-slate-100 text-slate-600 border border-slate-200";
  }
}

/** CRT, Games, Library, and other assignable free/special class slots */
export function specialPeriodCellClass(): string {
  return "bg-violet-50 text-violet-900 border border-violet-200";
}

export function classPeriodCellClass(): string {
  return "bg-blue-50/70 border-border";
}

export function emptyPeriodCellClass(): string {
  return "bg-slate-50 border-border";
}
