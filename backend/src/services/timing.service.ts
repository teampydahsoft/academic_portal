import type { RowDataPacket } from "mysql2";
import { buildDefaultWeeklySlots } from "../lib/default-timing-slots.js";
import { executeAcademic, queryAcademic, queryStudent } from "../db/pools.js";

export type DayCode = "MON" | "TUE" | "WED" | "THUR" | "FRI" | "SAT" | "SUN";
export type SlotType = "CLASS" | "BREAK" | "LUNCH" | "ACTIVITY" | "OTHER";
export type TemplateStatus = "draft" | "active" | "archived";

export const DAY_CODE_TO_LABEL: Record<DayCode, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THUR: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

export const DAY_LABEL_TO_CODE: Record<string, DayCode> = {
  Monday: "MON",
  Tuesday: "TUE",
  Wednesday: "WED",
  Thursday: "THUR",
  Friday: "FRI",
  Saturday: "SAT",
  Sunday: "SUN",
};

export function isNonClassTimingSlot(slot: {
  slotType: SlotType | string;
  isAssignable?: boolean;
}): boolean {
  return (
    slot.isAssignable === false ||
    slot.slotType === "BREAK" ||
    slot.slotType === "LUNCH" ||
    slot.slotType === "ACTIVITY" ||
    slot.slotType === "OTHER"
  );
}

export function timingSlotDisplayLabel(slot: {
  slotType: SlotType | string;
  label: string;
  isAssignable?: boolean;
  startTime?: string;
  endTime?: string;
}): string {
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
      const [sh, sm] = slot.startTime.split(":").map(Number);
      const [eh, em] = slot.endTime.split(":").map(Number);
      if ([sh, sm, eh, em].every(Number.isFinite)) {
        const minutes = eh * 60 + em - (sh * 60 + sm);
        if (minutes >= 45) return "Lunch Break";
      }
    }
    return "Break";
  }

  return label || "Period";
}

export const ALL_DAY_CODES: DayCode[] = [
  "MON",
  "TUE",
  "WED",
  "THUR",
  "FRI",
  "SAT",
  "SUN",
];

type TemplateRow = RowDataPacket & {
  id: number;
  college_id: number;
  academic_year_label: string;
  semester_number: number;
  name: string;
  status: TemplateStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  slot_count?: number;
};

type SlotRow = RowDataPacket & {
  id: number;
  template_id: number;
  day_of_week: DayCode;
  slot_order: number;
  label: string;
  start_time: string;
  end_time: string;
  slot_type: SlotType;
  is_active: number;
};

export type SlotInput = {
  dayOfWeek: DayCode;
  slotOrder: number;
  label: string;
  startTime: string;
  endTime: string;
  slotType: SlotType;
};

function formatTime(value: string) {
  return String(value).slice(0, 5);
}

function toMinutes(time: string) {
  const normalized = formatTime(time);
  const [h, m] = normalized.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return h * 60 + m;
}

export function validateSlots(slots: SlotInput[]) {
  const errors: string[] = [];

  for (const slot of slots) {
    if (!slot.label?.trim()) {
      errors.push("Slot label is required");
      continue;
    }
    if (!ALL_DAY_CODES.includes(slot.dayOfWeek)) {
      errors.push(`Invalid day: ${slot.dayOfWeek}`);
      continue;
    }
    if (!["CLASS", "BREAK", "LUNCH", "ACTIVITY", "OTHER"].includes(slot.slotType)) {
      errors.push(`Invalid slot type: ${slot.slotType}`);
      continue;
    }
    try {
      const start = toMinutes(slot.startTime);
      const end = toMinutes(slot.endTime);
      if (end <= start) {
        errors.push(
          `${DAY_CODE_TO_LABEL[slot.dayOfWeek]} ${slot.label}: end time must be after start time`,
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid time");
    }
  }

  const byDay = new Map<DayCode, SlotInput[]>();
  for (const slot of slots) {
    const list = byDay.get(slot.dayOfWeek) ?? [];
    list.push(slot);
    byDay.set(slot.dayOfWeek, list);
  }

  for (const [day, daySlots] of byDay) {
    const orders = new Set<number>();
    for (const slot of daySlots) {
      if (orders.has(slot.slotOrder)) {
        errors.push(
          `${DAY_CODE_TO_LABEL[day]}: duplicate order ${slot.slotOrder}`,
        );
      }
      orders.add(slot.slotOrder);
    }

    const sorted = [...daySlots].sort(
      (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (toMinutes(curr.startTime) < toMinutes(prev.endTime)) {
        errors.push(
          `${DAY_CODE_TO_LABEL[day]}: ${curr.label} overlaps ${prev.label}`,
        );
      }
    }
  }

  if (errors.length) {
    const err = new Error(errors[0]);
    (err as Error & { details?: string[] }).details = errors;
    throw err;
  }
}

export function mapSlot(row: SlotRow) {
  return {
    id: row.id,
    templateId: row.template_id,
    dayOfWeek: row.day_of_week,
    dayLabel: DAY_CODE_TO_LABEL[row.day_of_week] ?? row.day_of_week,
    slotOrder: row.slot_order,
    label: row.label,
    startTime: formatTime(row.start_time),
    endTime: formatTime(row.end_time),
    slotType: row.slot_type,
    isAssignable: row.slot_type === "CLASS",
    isActive: Number(row.is_active) === 1,
  };
}

async function collegeNameMap() {
  const colleges = await queryStudent<
    (RowDataPacket & { id: number; name: string })[]
  >(`SELECT id, name FROM colleges ORDER BY name`);
  return new Map(colleges.map((c) => [c.id, c.name]));
}

export async function resolveActiveTimingTemplate(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
}) {
  const rows = await queryAcademic<TemplateRow[]>(
    `
    SELECT id, college_id, academic_year_label, semester_number, name, status, notes,
           created_at, updated_at
    FROM ap_timing_templates
    WHERE college_id = ?
      AND academic_year_label = ?
      AND semester_number = ?
      AND status = 'active'
    ORDER BY id DESC
    LIMIT 1
    `,
    [input.collegeId, input.academicYear, input.semester],
  );
  return rows[0] ?? null;
}

export async function getTimingTemplateById(templateId: number) {
  const rows = await queryAcademic<TemplateRow[]>(
    `
    SELECT id, college_id, academic_year_label, semester_number, name, status, notes,
           created_at, updated_at
    FROM ap_timing_templates
    WHERE id = ?
    LIMIT 1
    `,
    [templateId],
  );
  return rows[0] ?? null;
}

export async function listTimingSlots(templateId: number, includeInactive = false) {
  const rows = await queryAcademic<SlotRow[]>(
    `
    SELECT id, template_id, day_of_week, slot_order, label, start_time, end_time, slot_type, is_active
    FROM ap_timing_template_slots
    WHERE template_id = ?
      ${includeInactive ? "" : "AND is_active = 1"}
    ORDER BY FIELD(day_of_week,'MON','TUE','WED','THUR','FRI','SAT','SUN'), slot_order, id
    `,
    [templateId],
  );
  return rows.map(mapSlot);
}

export async function getTimingTemplateDetail(
  templateId: number,
  options?: { includeInactiveSlots?: boolean },
) {
  const template = await getTimingTemplateById(templateId);
  if (!template) return null;
  const names = await collegeNameMap();
  const includeInactive = options?.includeInactiveSlots ?? true;
  const slots = await listTimingSlots(templateId, includeInactive);
  return {
    id: template.id,
    collegeId: template.college_id,
    collegeName: names.get(template.college_id) ?? `College ${template.college_id}`,
    academicYear: template.academic_year_label,
    semester: template.semester_number,
    name: template.name,
    status: template.status,
    notes: template.notes,
    createdAt: template.created_at,
    updatedAt: template.updated_at,
    slotCount: slots.length,
    slots,
    days: ALL_DAY_CODES.map((code) => ({
      dayOfWeek: code,
      dayLabel: DAY_CODE_TO_LABEL[code],
      slots: slots.filter((s) => s.dayOfWeek === code),
    })),
  };
}

export async function listTimingTemplates(filters?: {
  collegeId?: number;
  academicYear?: string;
  semester?: number;
  status?: string;
}) {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filters?.collegeId) {
    where.push("t.college_id = ?");
    params.push(filters.collegeId);
  }
  if (filters?.academicYear) {
    where.push("t.academic_year_label = ?");
    params.push(filters.academicYear);
  }
  if (filters?.semester) {
    where.push("t.semester_number = ?");
    params.push(filters.semester);
  }
  if (filters?.status) {
    where.push("t.status = ?");
    params.push(filters.status);
  }

  const rows = await queryAcademic<TemplateRow[]>(
    `
    SELECT
      t.id,
      t.college_id,
      t.academic_year_label,
      t.semester_number,
      t.name,
      t.status,
      t.notes,
      t.created_at,
      t.updated_at,
      COUNT(s.id) AS slot_count
    FROM ap_timing_templates t
    LEFT JOIN ap_timing_template_slots s
      ON s.template_id = t.id AND s.is_active = 1
    WHERE ${where.join(" AND ")}
    GROUP BY t.id
    ORDER BY t.updated_at DESC, t.id DESC
    `,
    params,
  );

  const names = await collegeNameMap();
  return rows.map((row) => ({
    id: row.id,
    collegeId: row.college_id,
    collegeName: names.get(row.college_id) ?? `College ${row.college_id}`,
    academicYear: row.academic_year_label,
    semester: row.semester_number,
    name: row.name,
    status: row.status,
    notes: row.notes,
    slotCount: Number(row.slot_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getActiveTimingForContext(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
}) {
  const template = await resolveActiveTimingTemplate(input);
  if (!template) return null;
  return getTimingTemplateDetail(template.id, { includeInactiveSlots: false });
}

async function assertUniqueActive(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
  excludeId?: number;
}) {
  const rows = await queryAcademic<TemplateRow[]>(
    `
    SELECT id, name
    FROM ap_timing_templates
    WHERE college_id = ?
      AND academic_year_label = ?
      AND semester_number = ?
      AND status = 'active'
      ${input.excludeId ? "AND id <> ?" : ""}
    LIMIT 1
    `,
    input.excludeId
      ? [input.collegeId, input.academicYear, input.semester, input.excludeId]
      : [input.collegeId, input.academicYear, input.semester],
  );
  if (rows[0]) {
    throw new Error(
      `An active timing template already exists for this college, academic year and semester (${rows[0].name}). Deactivate it first or activate this one to replace it.`,
    );
  }
}

export async function createTimingTemplate(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
  name: string;
  status?: TemplateStatus;
  notes?: string | null;
}) {
  const status = input.status ?? "draft";
  if (!input.name.trim()) throw new Error("Template name is required");
  if (status === "active") {
    await assertUniqueActive({
      collegeId: input.collegeId,
      academicYear: input.academicYear,
      semester: input.semester,
    });
  }

  const result = await executeAcademic(
    `
    INSERT INTO ap_timing_templates
      (college_id, academic_year_label, semester_number, name, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      input.collegeId,
      input.academicYear,
      input.semester,
      input.name.trim(),
      status,
      input.notes ?? null,
    ],
  );

  return getTimingTemplateDetail(Number(result.insertId));
}

export async function updateTimingTemplate(
  templateId: number,
  input: {
    name?: string;
    status?: TemplateStatus;
    notes?: string | null;
    collegeId?: number;
    academicYear?: string;
    semester?: number;
  },
) {
  const existing = await getTimingTemplateById(templateId);
  if (!existing) throw new Error("Timing template not found");

  const next = {
    name: input.name?.trim() || existing.name,
    status: input.status ?? existing.status,
    notes: input.notes === undefined ? existing.notes : input.notes,
    collegeId: input.collegeId ?? existing.college_id,
    academicYear: input.academicYear ?? existing.academic_year_label,
    semester: input.semester ?? existing.semester_number,
  };

  if (next.status === "active") {
    // Activating replaces other actives for same scope
    await executeAcademic(
      `
      UPDATE ap_timing_templates
      SET status = 'draft'
      WHERE college_id = ?
        AND academic_year_label = ?
        AND semester_number = ?
        AND status = 'active'
        AND id <> ?
      `,
      [next.collegeId, next.academicYear, next.semester, templateId],
    );
  }

  await executeAcademic(
    `
    UPDATE ap_timing_templates
    SET college_id = ?, academic_year_label = ?, semester_number = ?,
        name = ?, status = ?, notes = ?
    WHERE id = ?
    `,
    [
      next.collegeId,
      next.academicYear,
      next.semester,
      next.name,
      next.status,
      next.notes,
      templateId,
    ],
  );

  return getTimingTemplateDetail(templateId);
}

export async function setTimingTemplateStatus(
  templateId: number,
  status: TemplateStatus,
) {
  return updateTimingTemplate(templateId, { status });
}

function toSqlTime(value: string) {
  const t = formatTime(value);
  return t.length === 5 ? `${t}:00` : value;
}

export async function getTimingSlotUsage(templateId: number) {
  const rows = await queryAcademic<
    (RowDataPacket & { timing_slot_id: number; entry_count: number })[]
  >(
    `
    SELECT COALESCE(e.timing_slot_id, e.period_slot_id) AS timing_slot_id,
           COUNT(*) AS entry_count
    FROM ap_timetable_entries e
    INNER JOIN ap_timing_template_slots s
      ON s.id = COALESCE(e.timing_slot_id, e.period_slot_id)
    WHERE s.template_id = ?
    GROUP BY COALESCE(e.timing_slot_id, e.period_slot_id)
    `,
    [templateId],
  );
  const bySlotId: Record<number, number> = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.entry_count);
    bySlotId[row.timing_slot_id] = count;
    total += count;
  }
  return { bySlotId, total };
}

export type SlotSaveInput = SlotInput & { id?: number | null };

export async function replaceTimingSlots(
  templateId: number,
  slots: SlotSaveInput[],
  options?: { confirmDestructive?: boolean },
) {
  const existing = await getTimingTemplateById(templateId);
  if (!existing) throw new Error("Timing template not found");

  validateSlots(slots);

  const currentSlots = await listTimingSlots(templateId, true);
  const usage = await getTimingSlotUsage(templateId);

  const incomingIds = new Set(
    slots.map((s) => s.id).filter((id): id is number => Boolean(id)),
  );
  const removed = currentSlots.filter((s) => !incomingIds.has(s.id));
  const removedWithUsage = removed.filter((s) => (usage.bySlotId[s.id] ?? 0) > 0);

  const changedWithUsage: Array<{ id: number; label: string; entries: number }> = [];
  for (const slot of slots) {
    if (!slot.id) continue;
    const prev = currentSlots.find((s) => s.id === slot.id);
    if (!prev) continue;
    const entries = usage.bySlotId[slot.id] ?? 0;
    if (!entries) continue;
    const changed =
      prev.label !== slot.label.trim() ||
      prev.startTime !== formatTime(slot.startTime) ||
      prev.endTime !== formatTime(slot.endTime) ||
      prev.slotType !== slot.slotType ||
      prev.dayOfWeek !== slot.dayOfWeek;
    if (changed) {
      changedWithUsage.push({ id: slot.id, label: slot.label, entries });
    }
  }

  if (
    (removedWithUsage.length > 0 || changedWithUsage.length > 0) &&
    !options?.confirmDestructive
  ) {
    const affected = [
      ...removedWithUsage.map((s) => ({
        id: s.id,
        label: s.label,
        entries: usage.bySlotId[s.id] ?? 0,
        action: "delete" as const,
      })),
      ...changedWithUsage.map((s) => ({
        ...s,
        action: "change" as const,
      })),
    ];
    const totalEntries = affected.reduce((sum, item) => sum + item.entries, 0);
    const err = new Error(
      `This timing change affects ${totalEntries} timetable entries. Confirm to continue.`,
    );
    (err as Error & { code?: string; affected?: unknown }).code = "TIMING_IN_USE";
    (err as Error & { affected?: unknown }).affected = affected;
    throw err;
  }

  // Update / insert preserving IDs where provided; otherwise match by day+order
  const unmatchedCurrent = new Map(currentSlots.map((s) => [s.id, s]));
  const keptIds = new Set<number>();

  // Free unique (template, day, order) keys temporarily
  await executeAcademic(
    `
    UPDATE ap_timing_template_slots
    SET slot_order = slot_order + 10000
    WHERE template_id = ?
    `,
    [templateId],
  );

  for (const slot of slots) {
    let targetId = slot.id && unmatchedCurrent.has(slot.id) ? slot.id : null;
    if (!targetId) {
      const match = [...unmatchedCurrent.values()].find(
        (s) => s.dayOfWeek === slot.dayOfWeek && s.slotOrder === slot.slotOrder,
      );
      if (match) targetId = match.id;
    }

    if (targetId) {
      await executeAcademic(
        `
        UPDATE ap_timing_template_slots
        SET day_of_week = ?, slot_order = ?, label = ?, start_time = ?, end_time = ?,
            slot_type = ?, is_active = 1
        WHERE id = ? AND template_id = ?
        `,
        [
          slot.dayOfWeek,
          slot.slotOrder,
          slot.label.trim(),
          toSqlTime(slot.startTime),
          toSqlTime(slot.endTime),
          slot.slotType,
          targetId,
          templateId,
        ],
      );
      keptIds.add(targetId);
      unmatchedCurrent.delete(targetId);
    } else {
      const result = await executeAcademic(
        `
        INSERT INTO ap_timing_template_slots
          (template_id, day_of_week, slot_order, label, start_time, end_time, slot_type, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `,
        [
          templateId,
          slot.dayOfWeek,
          slot.slotOrder,
          slot.label.trim(),
          toSqlTime(slot.startTime),
          toSqlTime(slot.endTime),
          slot.slotType,
        ],
      );
      keptIds.add(Number(result.insertId));
    }
  }

  for (const slot of unmatchedCurrent.values()) {
    // Clear entry refs that pointed at deleted slots, then delete slot
    await executeAcademic(
      `
      UPDATE ap_timetable_entries
      SET timing_slot_id = NULL
      WHERE timing_slot_id = ? OR period_slot_id = ?
      `,
      [slot.id, slot.id],
    );
    await executeAcademic(
      `DELETE FROM ap_timing_template_slots WHERE id = ? AND template_id = ?`,
      [slot.id, templateId],
    );
  }

  await executeAcademic(
    `UPDATE ap_timing_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [templateId],
  );

  return getTimingTemplateDetail(templateId);
}

export async function getOrCreateTimingForContext(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
  name?: string;
}) {
  const active = await resolveActiveTimingTemplate(input);
  if (active) {
    const detail = await getTimingTemplateDetail(active.id);
    if (detail && detail.slots.length === 0) {
      return replaceTimingSlots(active.id, buildDefaultWeeklySlots(), {
        confirmDestructive: true,
      });
    }
    return detail;
  }

  const any = await queryAcademic<TemplateRow[]>(
    `
    SELECT id FROM ap_timing_templates
    WHERE college_id = ? AND academic_year_label = ? AND semester_number = ?
    ORDER BY FIELD(status,'active','draft','archived'), id DESC
    LIMIT 1
    `,
    [input.collegeId, input.academicYear, input.semester],
  );
  if (any[0]) {
    await setTimingTemplateStatus(any[0].id, "active");
    const detail = await getTimingTemplateDetail(any[0].id);
    if (detail && detail.slots.length === 0) {
      return replaceTimingSlots(any[0].id, buildDefaultWeeklySlots(), {
        confirmDestructive: true,
      });
    }
    return detail;
  }

  const created = await createTimingTemplate({
    collegeId: input.collegeId,
    academicYear: input.academicYear,
    semester: input.semester,
    name: input.name?.trim() || `Schedule ${input.academicYear} Sem ${input.semester}`,
    status: "active",
  });
  if (!created) throw new Error("Failed to create timing template");

  // New templates start with Mon–Sat × P1–P7 so colleges only edit times.
  return replaceTimingSlots(created.id, buildDefaultWeeklySlots(), {
    confirmDestructive: true,
  });
}

export async function saveTimingForContext(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
  name?: string;
  slots: SlotSaveInput[];
  confirmDestructive?: boolean;
}) {
  const template = await getOrCreateTimingForContext({
    collegeId: input.collegeId,
    academicYear: input.academicYear,
    semester: input.semester,
    name: input.name,
  });
  if (!template) throw new Error("Failed to resolve timing template");

  if (input.name?.trim() && input.name.trim() !== template.name) {
    await updateTimingTemplate(template.id, { name: input.name.trim(), status: "active" });
  } else if (template.status !== "active") {
    await setTimingTemplateStatus(template.id, "active");
  }

  return replaceTimingSlots(template.id, input.slots, {
    confirmDestructive: input.confirmDestructive,
  });
}

/** @deprecated Prefer createTimingTemplate + replaceTimingSlots */
export async function upsertTimingTemplate(input: {
  collegeId: number;
  academicYear: string;
  semester: number;
  name: string;
  status?: TemplateStatus;
  notes?: string;
  slots: SlotInput[];
}) {
  validateSlots(input.slots);
  const created = await createTimingTemplate({
    collegeId: input.collegeId,
    academicYear: input.academicYear,
    semester: input.semester,
    name: input.name,
    status: input.status ?? "draft",
    notes: input.notes,
  });
  if (!created) throw new Error("Failed to create timing template");
  return replaceTimingSlots(created.id, input.slots, { confirmDestructive: true });
}
