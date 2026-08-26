"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type DayCode = "MON" | "TUE" | "WED" | "THUR" | "FRI" | "SAT" | "SUN";
type SlotType = "CLASS" | "BREAK" | "LUNCH" | "ACTIVITY" | "OTHER";

type SlotDraft = {
  key: string;
  id?: number | null;
  dayOfWeek: DayCode;
  slotOrder: number;
  label: string;
  startTime: string;
  endTime: string;
  slotType: SlotType;
};

type TimingDetail = {
  id: number;
  name: string;
  collegeName?: string;
  academicYear: string;
  semester: number;
  status: string;
  slots: Array<{
    id: number;
    dayOfWeek: DayCode;
    slotOrder: number;
    label: string;
    startTime: string;
    endTime: string;
    slotType: SlotType;
  }>;
};

const DAYS: { code: DayCode; label: string; short: string }[] = [
  { code: "MON", label: "Monday", short: "Mon" },
  { code: "TUE", label: "Tuesday", short: "Tue" },
  { code: "WED", label: "Wednesday", short: "Wed" },
  { code: "THUR", label: "Thursday", short: "Thu" },
  { code: "FRI", label: "Friday", short: "Fri" },
  { code: "SAT", label: "Saturday", short: "Sat" },
  { code: "SUN", label: "Sunday", short: "Sun" },
];

const SLOT_TYPES: SlotType[] = ["CLASS", "BREAK", "LUNCH", "ACTIVITY", "OTHER"];

const DEFAULT_PERIODS = [
  { label: "P1", startTime: "09:00", endTime: "09:50", slotType: "CLASS" as SlotType },
  { label: "P2", startTime: "09:50", endTime: "10:40", slotType: "CLASS" as SlotType },
  { label: "P3", startTime: "10:50", endTime: "11:40", slotType: "CLASS" as SlotType },
  { label: "P4", startTime: "11:40", endTime: "12:30", slotType: "CLASS" as SlotType },
  { label: "P5", startTime: "13:20", endTime: "14:10", slotType: "CLASS" as SlotType },
  { label: "P6", startTime: "14:10", endTime: "15:00", slotType: "CLASS" as SlotType },
  { label: "P7", startTime: "15:00", endTime: "15:50", slotType: "CLASS" as SlotType },
];

const WORKING_DAYS: DayCode[] = ["MON", "TUE", "WED", "THUR", "FRI", "SAT"];

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildDefaultWeeklySlots(): SlotDraft[] {
  const slots: SlotDraft[] = [];
  for (const dayOfWeek of WORKING_DAYS) {
    DEFAULT_PERIODS.forEach((period, index) => {
      slots.push({
        key: newKey(),
        id: null,
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

type Props = {
  open: boolean;
  collegeId: number;
  collegeName: string;
  academicYear: string;
  semester: number;
  onClose: () => void;
  onSaved: () => void;
};

export function TimingEditorDrawer({
  open,
  collegeId,
  collegeName,
  academicYear,
  semester,
  onClose,
  onSaved,
}: Props) {
  const [templateName, setTemplateName] = useState("");
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [activeDay, setActiveDay] = useState<DayCode>("MON");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setDetails([]);
      setActiveDay("MON");
      try {
        const params = new URLSearchParams({
          collegeId: String(collegeId),
          academicYear,
          semester: String(semester),
        });
        const response = await apiFetch(`/timings/for-context?${params}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to load timings");
        const payload = (await response.json()) as { timing: TimingDetail | null };
        if (cancelled) return;
        if (payload.timing) {
          setTemplateName(payload.timing.name);
          if (payload.timing.slots.length === 0) {
            setSlots(buildDefaultWeeklySlots());
          } else {
            setSlots(
              payload.timing.slots.map((slot) => ({
                key: `db-${slot.id}`,
                id: slot.id,
                dayOfWeek: slot.dayOfWeek,
                slotOrder: slot.slotOrder,
                label: slot.label,
                startTime: slot.startTime,
                endTime: slot.endTime,
                slotType: slot.slotType,
              })),
            );
          }
        } else {
          setTemplateName(
            `${collegeName.replace(/^Pydah\s+/i, "").trim() || "College"} Regular Schedule`,
          );
          setSlots(buildDefaultWeeklySlots());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load timings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, collegeId, academicYear, semester, collegeName]);

  const slotsByDay = useMemo(() => {
    const map = new Map<DayCode, SlotDraft[]>();
    for (const day of DAYS) map.set(day.code, []);
    for (const slot of slots) {
      const list = map.get(slot.dayOfWeek) ?? [];
      list.push(slot);
      map.set(slot.dayOfWeek, list);
    }
    for (const [day, list] of map) {
      list.sort((a, b) => a.slotOrder - b.slotOrder || a.startTime.localeCompare(b.startTime));
      map.set(day, list);
    }
    return map;
  }, [slots]);

  const activeSlots = slotsByDay.get(activeDay) ?? [];

  const updateSlot = (key: string, patch: Partial<SlotDraft>) => {
    setSlots((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const removeSlot = (key: string) => {
    setSlots((prev) => prev.filter((s) => s.key !== key));
  };

  const addSlot = () => {
    const nextOrder =
      activeSlots.length === 0 ? 1 : Math.max(...activeSlots.map((s) => s.slotOrder)) + 1;
    setSlots((prev) => [
      ...prev,
      {
        key: newKey(),
        id: null,
        dayOfWeek: activeDay,
        slotOrder: nextOrder,
        label: `P${nextOrder}`,
        startTime: "09:00",
        endTime: "09:50",
        slotType: "CLASS",
      },
    ]);
  };

  const applyActiveDayToWeekdays = () => {
    const source = [...activeSlots].sort((a, b) => a.slotOrder - b.slotOrder);
    if (source.length === 0) return;
    setSlots((prev) => {
      const kept = prev.filter((s) => !WORKING_DAYS.includes(s.dayOfWeek));
      const copied: SlotDraft[] = [];
      for (const day of WORKING_DAYS) {
        source.forEach((slot, index) => {
          copied.push({
            key: newKey(),
            id: day === activeDay ? slot.id : null,
            dayOfWeek: day,
            slotOrder: index + 1,
            label: slot.label,
            startTime: slot.startTime,
            endTime: slot.endTime,
            slotType: slot.slotType,
          });
        });
      }
      return [...kept, ...copied];
    });
    setToast("Applied this day’s schedule to Mon–Sat.");
    setTimeout(() => setToast(null), 2500);
  };

  const resetToDefaultSeven = () => {
    setSlots(buildDefaultWeeklySlots());
    setActiveDay("MON");
    setToast("Reset to default P1–P7 (Mon–Sat). Save to keep.");
    setTimeout(() => setToast(null), 2500);
  };

  const save = async (confirmDestructive = false) => {
    setBusy(true);
    setError(null);
    setDetails([]);
    try {
      const normalized: SlotDraft[] = [];
      for (const day of DAYS) {
        const daySlots = [...(slotsByDay.get(day.code) ?? [])].sort(
          (a, b) => a.slotOrder - b.slotOrder || a.startTime.localeCompare(b.startTime),
        );
        daySlots.forEach((slot, index) => {
          normalized.push({ ...slot, slotOrder: index + 1 });
        });
      }

      const response = await apiFetch(`/timings/for-context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId,
          academicYear,
          semester,
          name: templateName.trim() || `Schedule ${academicYear} Sem ${semester}`,
          confirmDestructive,
          slots: normalized.map((slot) => ({
            id: slot.id ?? null,
            dayOfWeek: slot.dayOfWeek,
            slotOrder: slot.slotOrder,
            label: slot.label,
            startTime: slot.startTime,
            endTime: slot.endTime,
            slotType: slot.slotType,
          })),
        }),
      });
      const data = await response.json();
      if (response.status === 409 && data.code === "TIMING_IN_USE") {
        const ok = window.confirm(
          `${data.message}\n\nContinue and apply these timing changes?`,
        );
        if (ok) {
          await save(true);
          return;
        }
        setError(data.message);
        return;
      }
      if (!response.ok) {
        if (Array.isArray(data.details)) setDetails(data.details);
        throw new Error(data.message || "Failed to save timings");
      }
      setToast("College timings updated successfully.");
      onSaved();
      setTimeout(() => {
        setToast(null);
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save timings");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-navy-950/40"
        aria-label="Close timings drawer"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-navy-900">Edit College Timings</h2>
          <p className="mt-1 text-sm text-slate-600">
            {collegeName} · {academicYear} · Sem {semester}
          </p>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-slate-600">Template name</span>
            <input
              className="h-9 w-full rounded-md border border-border px-2"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2">
          {DAYS.map((day) => {
            const count = slotsByDay.get(day.code)?.length ?? 0;
            return (
              <button
                key={day.code}
                type="button"
                onClick={() => setActiveDay(day.code)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  activeDay === day.code
                    ? "bg-navy-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
              >
                {day.short}
                <span
                  className={cn(
                    "ml-1 text-xs",
                    activeDay === day.code ? "text-white/70" : "text-slate-500",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
          <Button size="sm" variant="secondary" onClick={addSlot} disabled={loading}>
            + Add slot
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={applyActiveDayToWeekdays}
            disabled={loading || activeSlots.length === 0}
          >
            Apply to Mon–Sat
          </Button>
          <Button size="sm" variant="ghost" onClick={resetToDefaultSeven} disabled={loading}>
            Reset P1–P7
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading timings…</p>
          ) : activeSlots.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-slate-600">No slots for this day.</p>
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={addSlot}>
                  + Add slot
                </Button>
                {WORKING_DAYS.includes(activeDay) ? (
                  <Button size="sm" onClick={resetToDefaultSeven}>
                    Load default P1–P7
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-2 font-medium">Label</th>
                    <th className="py-2 pr-2 font-medium">Start</th>
                    <th className="py-2 pr-2 font-medium">End</th>
                    <th className="py-2 pr-2 font-medium">Type</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {activeSlots.map((slot) => (
                    <tr key={slot.key} className="border-b border-border/70">
                      <td className="py-2 pr-2">
                        <input
                          className="h-9 w-full min-w-[4rem] rounded-md border border-border px-2"
                          value={slot.label}
                          onChange={(e) => updateSlot(slot.key, { label: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="time"
                          className="h-9 w-full rounded-md border border-border px-2"
                          value={slot.startTime}
                          onChange={(e) => updateSlot(slot.key, { startTime: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="time"
                          className="h-9 w-full rounded-md border border-border px-2"
                          value={slot.endTime}
                          onChange={(e) => updateSlot(slot.key, { endTime: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          className="h-9 w-full rounded-md border border-border px-2"
                          value={slot.slotType}
                          onChange={(e) =>
                            updateSlot(slot.key, { slotType: e.target.value as SlotType })
                          }
                        >
                          {SLOT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => removeSlot(slot.key)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error ? (
            <div className="mt-4 rounded-md border border-critical/30 bg-red-50 p-3 text-sm text-critical">
              <p>{error}</p>
              {details.length > 0 ? (
                <ul className="mt-2 list-disc pl-4 text-slate-700">
                  {details.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-4">
          <div className="text-sm text-success">{toast}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save(false)} disabled={busy || loading}>
              Save Timings
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
