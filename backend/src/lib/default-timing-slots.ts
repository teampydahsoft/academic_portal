import type { DayCode, SlotType } from "../services/timing.service.js";

/** Default Mon–Sat day: 7 teaching periods. Colleges edit times as needed. */
export const DEFAULT_PERIOD_TIMES: Array<{
  label: string;
  startTime: string;
  endTime: string;
  slotType: SlotType;
}> = [
  { label: "P1", startTime: "09:00", endTime: "09:50", slotType: "CLASS" },
  { label: "P2", startTime: "09:50", endTime: "10:40", slotType: "CLASS" },
  { label: "P3", startTime: "10:50", endTime: "11:40", slotType: "CLASS" },
  { label: "P4", startTime: "11:40", endTime: "12:30", slotType: "CLASS" },
  { label: "P5", startTime: "13:20", endTime: "14:10", slotType: "CLASS" },
  { label: "P6", startTime: "14:10", endTime: "15:00", slotType: "CLASS" },
  { label: "P7", startTime: "15:00", endTime: "15:50", slotType: "CLASS" },
];

export const DEFAULT_WORKING_DAYS: DayCode[] = [
  "MON",
  "TUE",
  "WED",
  "THUR",
  "FRI",
  "SAT",
];

export function buildDefaultWeeklySlots() {
  const slots: Array<{
    dayOfWeek: DayCode;
    slotOrder: number;
    label: string;
    startTime: string;
    endTime: string;
    slotType: SlotType;
  }> = [];

  for (const dayOfWeek of DEFAULT_WORKING_DAYS) {
    DEFAULT_PERIOD_TIMES.forEach((period, index) => {
      slots.push({
        dayOfWeek,
        slotOrder: index + 1,
        label: period.label,
        startTime: period.startTime,
        endTime: period.endTime,
        slotType: period.slotType,
      });
    });
  }

  return slots;
}
