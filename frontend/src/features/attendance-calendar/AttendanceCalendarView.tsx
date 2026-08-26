"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MultiSelectFilter } from "./MultiSelectFilter";

type AttendanceBadge =
  | "sun"
  | "submitted"
  | "pending"
  | "upcoming"
  | "institute_holiday"
  | "public_holiday";

type DayState = "working_day" | "sunday" | "institute_holiday" | "public_holiday";

type InstituteHoliday = {
  id: number;
  holidayDate: string;
  title: string;
  description: string | null;
  targetCollege: string | null;
  targetBatch: string | null;
  targetCourse: string | null;
  targetBranch: string | null;
  targetYear: string | null;
  targetSemester: string | null;
  isGlobal: boolean;
};

type PublicHoliday = {
  date: string;
  title: string;
  localName: string | null;
};

type CalendarDay = {
  date: string;
  weekday: string;
  isSunday: boolean;
  state: DayState;
  label: string;
  badge: AttendanceBadge;
  badgeLabel: string;
  instructionalDay: boolean;
  sessionTotal: number;
  sessionPosted: number;
  instituteHolidays: InstituteHoliday[];
  publicHoliday: PublicHoliday | null;
};

type MonthResponse = {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  today: string;
  days: CalendarDay[];
  instituteHolidays: InstituteHoliday[];
  publicHolidays: PublicHoliday[];
  publicHolidaysError: string | null;
};

type TargetOptions = {
  colleges: { id: number; name: string }[];
  programs: { id: number; name: string; collegeId: number }[];
  batches: string[];
  defaultRecipientCount: number;
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function toIso(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function formatSelectedDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function badgeClass(badge: AttendanceBadge) {
  switch (badge) {
    case "sun":
      return "bg-amber-100 text-amber-800";
    case "submitted":
      return "bg-emerald-100 text-emerald-800";
    case "pending":
      return "bg-orange-100 text-orange-800";
    case "upcoming":
      return "bg-sky-100 text-sky-800";
    case "institute_holiday":
      return "bg-violet-100 text-violet-800";
    case "public_holiday":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function parseTargetList(raw: string | null | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    if (parsed != null && String(parsed).trim()) return [String(parsed).trim()];
  } catch {
    // fall through
  }
  return text
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AttendanceCalendarView() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-based
  const [payload, setPayload] = useState<MonthResponse | null>(null);
  const [targets, setTargets] = useState<TargetOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [collegeNames, setCollegeNames] = useState<string[]>([]);
  const [batchValues, setBatchValues] = useState<string[]>([]);
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [editingHolidayId, setEditingHolidayId] = useState<number | null>(null);
  const [recipients, setRecipients] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  const dayByDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of payload?.days ?? []) map.set(day.date, day);
    return map;
  }, [payload]);

  const selected = selectedDate ? dayByDate.get(selectedDate) ?? null : null;

  const loadMonth = useCallback(async (year: number, monthIndex: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(monthIndex + 1),
      });
      const response = await apiFetch(`/academic-dates/attendance-calendar/month?${params}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Failed to load calendar",
        );
      }
      setPayload(body as MonthResponse);
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMonth(viewYear, viewMonth);
  }, [viewYear, viewMonth, loadMonth]);

  useEffect(() => {
    let cancelled = false;
    async function loadTargets() {
      try {
        const response = await apiFetch(`/academic-dates/holiday-targets`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const data = body as TargetOptions;
        setTargets(data);
        setRecipients(data.defaultRecipientCount ?? 0);
      } catch {
        if (!cancelled) setTargets(null);
      }
    }
    void loadTargets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadRecipients() {
      try {
        const params = new URLSearchParams();
        if (collegeNames.length) params.set("colleges", collegeNames.join("|"));
        if (batchValues.length) params.set("batches", batchValues.join("|"));
        if (programNames.length) params.set("programs", programNames.join("|"));
        const response = await apiFetch(`/academic-dates/holiday-recipients?${params}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        setRecipients(Number((body as { estimatedRecipients?: number }).estimatedRecipients ?? 0));
      } catch {
        // keep previous estimate
      }
    }
    void loadRecipients();
    return () => {
      cancelled = true;
    };
  }, [collegeNames, batchValues, programNames]);

  useEffect(() => {
    setSaveError(null);
    setSaveOk(null);

    if (!selectedDate) {
      setEditingHolidayId(null);
      setTitle("");
      setNotes("");
      setCollegeNames([]);
      setBatchValues([]);
      setProgramNames([]);
      return;
    }

    const day = dayByDate.get(selectedDate);
    const existing = day?.instituteHolidays?.[0] ?? null;
    if (!existing) {
      setEditingHolidayId(null);
      setTitle("");
      setNotes("");
      setCollegeNames([]);
      setBatchValues([]);
      setProgramNames([]);
      return;
    }

    setEditingHolidayId(existing.id);
    setTitle(existing.title ?? "");
    setNotes(existing.description ?? "");
    setCollegeNames(parseTargetList(existing.targetCollege));
    setBatchValues(parseTargetList(existing.targetBatch));
    setProgramNames(parseTargetList(existing.targetCourse));
  }, [selectedDate, dayByDate]);

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function loadHolidayIntoForm(holiday: InstituteHoliday) {
    setEditingHolidayId(holiday.id);
    setTitle(holiday.title ?? "");
    setNotes(holiday.description ?? "");
    setCollegeNames(parseTargetList(holiday.targetCollege));
    setBatchValues(parseTargetList(holiday.targetBatch));
    setProgramNames(parseTargetList(holiday.targetCourse));
    setSaveError(null);
    setSaveOk(null);
  }

  function startNewHoliday() {
    setEditingHolidayId(null);
    setTitle("");
    setNotes("");
    setCollegeNames([]);
    setBatchValues([]);
    setProgramNames([]);
    setSaveError(null);
    setSaveOk(null);
  }

  async function saveHoliday() {
    if (!selectedDate || !title.trim()) {
      setSaveError("Holiday title is required");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const isUpdate = editingHolidayId != null;
      const response = await apiFetch(
        isUpdate
          ? `/academic-dates/holidays/${editingHolidayId}`
          : `/academic-dates/holidays`,
        {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holidayDate: selectedDate,
            title: title.trim(),
            description: notes.trim() || null,
            targetColleges: collegeNames,
            targetBatches: batchValues,
            targetPrograms: programNames,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Failed to save holiday",
        );
      }

      const appliesToAll =
        body?.appliesToAllStudents === true ||
        (!collegeNames.length && !batchValues.length && !programNames.length);
      const savedId = Number(body?.holiday?.id ?? editingHolidayId ?? 0);
      if (savedId) setEditingHolidayId(savedId);

      setSaveOk(
        appliesToAll
          ? `Saved to Student Database as Global (all students).`
          : `Saved to Student Database for the selected audience.`,
      );
      await loadMonth(viewYear, viewMonth);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save holiday");
    } finally {
      setSaving(false);
    }
  }

  const gridCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = first.getDay(); // Sunday-first
    const count = daysInMonth(viewYear, viewMonth);
    const prevCount = daysInMonth(viewYear, viewMonth - 1);
    const cells: Array<{ iso: string; day: number; inMonth: boolean }> = [];

    for (let i = startOffset - 1; i >= 0; i -= 1) {
      const day = prevCount - i;
      const date = new Date(viewYear, viewMonth - 1, day);
      cells.push({
        iso: toIso(date.getFullYear(), date.getMonth(), day),
        day,
        inMonth: false,
      });
    }
    for (let day = 1; day <= count; day += 1) {
      cells.push({
        iso: toIso(viewYear, viewMonth, day),
        day,
        inMonth: true,
      });
    }
    let nextDay = 1;
    while (cells.length % 7 !== 0) {
      const date = new Date(viewYear, viewMonth + 1, nextDay);
      cells.push({
        iso: toIso(date.getFullYear(), date.getMonth(), nextDay),
        day: nextDay,
        inMonth: false,
      });
      nextDay += 1;
    }
    return cells;
  }, [viewYear, viewMonth]);

  return (
    <div>
      <div className="mb-5 flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-info">
          <CalendarDays className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-navy-900">
            Attendance Calendar
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Review public holidays, institute breaks, and mark custom holidays.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between gap-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-navy-900">
                {MONTH_LABELS[viewMonth]} {viewYear}
              </h2>
              <p className="text-xs text-slate-500">Tap a date to view details.</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">Loading calendar…</div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-4 text-sm text-critical">
              {error}
            </div>
          ) : null}

          {!loading && !error ? (
            <>
              <div className="mt-3 grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-2">
                {gridCells.map((cell) => {
                  const day = dayByDate.get(cell.iso);
                  const selectedCell = cell.iso === selectedDate;
                  const isToday = cell.iso === payload?.today;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedDate(cell.iso)}
                      className={cn(
                        "flex min-h-[5.25rem] flex-col rounded-lg border px-2 py-2 text-left transition-colors",
                        cell.inMonth
                          ? "border-slate-200 bg-white hover:border-sky-300"
                          : "border-transparent bg-transparent text-slate-300",
                        selectedCell && cell.inMonth && "border-2 border-sky-500 bg-sky-50",
                        isToday && cell.inMonth && !selectedCell && "ring-1 ring-navy-800/30",
                      )}
                    >
                      <span
                        className={cn(
                          "self-end text-sm font-medium",
                          cell.inMonth ? "text-slate-700" : "text-slate-300",
                        )}
                      >
                        {cell.day}
                      </span>
                      {cell.inMonth && day ? (
                        <span
                          className={cn(
                            "mt-auto inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            badgeClass(day.badge),
                          )}
                        >
                          {day.badgeLabel}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              {payload?.publicHolidaysError ? (
                <p className="mt-3 text-xs text-warning">{payload.publicHolidaysError}</p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-navy-900">Selected Date</h3>
              {selectedDate ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {formatSelectedDate(selectedDate)}
                </span>
              ) : null}
            </div>

            {!selectedDate || !selected ? (
              <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Choose a date on the calendar to view holiday details or mark an institute break.
              </div>
            ) : (
              <div className="space-y-4">
                <div
                  className={cn(
                    "rounded-lg border px-3 py-3",
                    selected.instructionalDay
                      ? "border-sky-200 bg-sky-50"
                      : selected.state === "sunday"
                        ? "border-amber-200 bg-amber-50"
                        : selected.state === "institute_holiday"
                          ? "border-violet-200 bg-violet-50"
                          : "border-amber-200 bg-amber-50",
                  )}
                >
                  <p className="text-sm font-semibold text-navy-900">
                    {selected.instructionalDay
                      ? "Instructional Day"
                      : selected.state === "sunday"
                        ? "Sunday"
                        : selected.state === "institute_holiday"
                          ? "Institute Holiday"
                          : "Public Holiday"}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {selected.instructionalDay
                      ? "Classes are expected to be held on this date."
                      : selected.state === "sunday"
                        ? "No normal class session should be expected."
                        : selected.instituteHolidays[0]?.title ||
                          selected.publicHoliday?.title ||
                          "Holiday / non-working day."}
                  </p>
                </div>

                {selected.instituteHolidays.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Institute holidays
                    </p>
                    {selected.instituteHolidays.map((holiday) => (
                      <div
                        key={holiday.id}
                        className={cn(
                          "rounded-lg border p-3",
                          editingHolidayId === holiday.id
                            ? "border-violet-400 bg-violet-50"
                            : "border-violet-200 bg-violet-50/70",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-violet-900">{holiday.title}</p>
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                            {holiday.isGlobal ? "Global (all students)" : "Targeted"}
                          </span>
                          <button
                            type="button"
                            onClick={() => loadHolidayIntoForm(holiday)}
                            className="ml-auto text-[11px] font-semibold text-violet-800 underline-offset-2 hover:underline"
                          >
                            Edit
                          </button>
                        </div>
                        {holiday.description?.trim() ? (
                          <p className="mt-1 text-xs text-violet-800">{holiday.description}</p>
                        ) : null}
                        <p className="mt-2 text-xs text-violet-800">
                          Audience:{" "}
                          {holiday.isGlobal
                            ? "Everyone — empty/null targets apply to all students"
                            : [
                                ...parseTargetList(holiday.targetCollege).map((v) => `College ${v}`),
                                ...parseTargetList(holiday.targetCourse).map((v) => `Program ${v}`),
                                ...parseTargetList(holiday.targetBatch).map((v) => `Batch ${v}`),
                                ...parseTargetList(holiday.targetBranch).map((v) => `Branch ${v}`),
                                ...parseTargetList(holiday.targetYear).map((v) => `Year ${v}`),
                                ...parseTargetList(holiday.targetSemester).map(
                                  (v) => `Semester ${v}`,
                                ),
                              ].join(" · ")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {selected.publicHoliday ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                      Public holiday
                    </p>
                    <p className="mt-1 font-medium text-amber-950">{selected.publicHoliday.title}</p>
                  </div>
                ) : null}

                {selected.instructionalDay ||
                selected.state === "sunday" ||
                selected.state === "institute_holiday" ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {editingHolidayId
                          ? "Edit institute holiday"
                          : "Mark institute holiday"}
                      </p>
                      {editingHolidayId ? (
                        <button
                          type="button"
                          onClick={startNewHoliday}
                          className="text-[11px] font-semibold text-slate-600 underline-offset-2 hover:underline"
                        >
                          Add another
                        </button>
                      ) : null}
                    </div>
                    <label className="block text-xs font-medium text-slate-600">
                      Holiday Title
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Founders' Day"
                        className="mt-1 h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Notes (visible to staff)
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Optional notes"
                        className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-navy-800"
                      />
                    </label>

                    <div className="rounded-lg border border-border bg-slate-50 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                          <Users className="h-3.5 w-3.5" />
                          Target Audience
                        </p>
                        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800">
                          Est. Recipients: {recipients.toLocaleString("en-IN")}
                        </span>
                      </div>
                      <p className="mb-3 text-xs text-slate-500">
                        Leave Colleges / Batches / Programs empty to apply to all students
                        (Global). Selections are saved to Student Database.
                      </p>

                      <div className="space-y-3">
                        <MultiSelectFilter
                          label="Colleges"
                          allLabel="All Colleges"
                          values={collegeNames}
                          onChange={setCollegeNames}
                          options={(targets?.colleges ?? []).map((college) => ({
                            value: college.name,
                            label: college.name,
                          }))}
                        />
                        <MultiSelectFilter
                          label="Batches"
                          allLabel="All Batches"
                          values={batchValues}
                          onChange={setBatchValues}
                          options={(targets?.batches ?? []).map((batch) => ({
                            value: batch,
                            label: batch,
                          }))}
                        />
                        <MultiSelectFilter
                          label="Programs"
                          allLabel="All Programs"
                          values={programNames}
                          onChange={setProgramNames}
                          options={(targets?.programs ?? []).map((program) => ({
                            value: program.name,
                            label: program.name,
                          }))}
                        />
                      </div>
                    </div>

                    {saveError ? <p className="text-sm text-critical">{saveError}</p> : null}
                    {saveOk ? <p className="text-sm text-success">{saveOk}</p> : null}

                    <Button
                      type="button"
                      onClick={() => void saveHoliday()}
                      disabled={saving || !title.trim()}
                    >
                      {saving
                        ? "Saving to Student Database…"
                        : editingHolidayId
                          ? "Update in Student Database"
                          : "Save to Student Database"}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {!selectedDate ? (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-3 text-base font-semibold text-navy-900">Calendar Legend</h3>
              <ul className="space-y-2.5 text-sm text-slate-700">
                <LegendItem color="bg-amber-400" label="Public Holiday" />
                <LegendItem color="bg-amber-300" label="Sunday" />
                <LegendItem color="bg-violet-500" label="Institute Holiday" />
                <LegendItem color="bg-sky-400" label="Working Day" />
              </ul>
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attendance badges
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeClass("submitted"))}>
                    Submitted
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeClass("pending"))}>
                    Pending
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeClass("upcoming"))}>
                    Upcoming
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeClass("sun"))}>
                    Sun
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
      <span>{label}</span>
    </li>
  );
}
