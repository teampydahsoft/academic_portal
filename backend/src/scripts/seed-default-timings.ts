import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { queryStudent } from "../db/pools.js";
import {
  buildDefaultWeeklySlots,
  DEFAULT_PERIOD_TIMES,
  DEFAULT_WORKING_DAYS,
} from "../lib/default-timing-slots.js";
import type { DayCode, SlotSaveInput } from "../services/timing.service.js";
import {
  createTimingTemplate,
  getTimingTemplateDetail,
  listTimingSlots,
  replaceTimingSlots,
  resolveActiveTimingTemplate,
  setTimingTemplateStatus,
} from "../services/timing.service.js";

/**
 * Seeds default Mon–Sat × P1–P7 timings for every college.
 *
 * - Empty template → full default week
 * - Partial template → fill missing working days (keeps existing day slots)
 * - Complete week → skip (unless --force)
 *
 * Usage:
 *   npm run db:seed:timings
 *   npm run db:seed:timings -- 2026-2027 1
 *   npm run db:seed:timings -- 2026-2027 1 --force
 */
async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");
  const academicYear = args[0] || "2026-2027";
  const semester = Number(args[1] || 1);
  if (!Number.isFinite(semester) || semester < 1) {
    throw new Error("Invalid semester");
  }

  const colleges = await queryStudent<Array<RowDataPacket & { id: number; name: string }>>(
    `SELECT id, name FROM colleges ORDER BY id`,
  );

  console.log(
    `Seeding default timings for ${colleges.length} colleges (${academicYear}, Sem ${semester})${force ? " [FORCE]" : ""}…`,
  );

  let created = 0;
  let filled = 0;
  let skipped = 0;

  for (const college of colleges) {
    const active = await resolveActiveTimingTemplate({
      collegeId: college.id,
      academicYear,
      semester,
    });

    let templateId = active?.id ?? null;

    if (!templateId) {
      const createdTemplate = await createTimingTemplate({
        collegeId: college.id,
        academicYear,
        semester,
        name: `${college.name.replace(/^Pydah\s+/i, "").trim() || "College"} Regular Schedule`,
        status: "active",
      });
      if (!createdTemplate) {
        console.warn(`  skip college ${college.id}: create failed`);
        continue;
      }
      templateId = createdTemplate.id;
      created += 1;
    } else if (active && active.status !== "active") {
      await setTimingTemplateStatus(templateId, "active");
    }

    const existing = await listTimingSlots(templateId);
    const byDay = new Map<DayCode, typeof existing>();
    for (const day of DEFAULT_WORKING_DAYS) byDay.set(day, []);
    for (const slot of existing) {
      if (!DEFAULT_WORKING_DAYS.includes(slot.dayOfWeek)) continue;
      const list = byDay.get(slot.dayOfWeek) ?? [];
      list.push(slot);
      byDay.set(slot.dayOfWeek, list);
    }

    const emptyWorkingDays = DEFAULT_WORKING_DAYS.filter(
      (day) => (byDay.get(day) ?? []).length === 0,
    );
    const complete =
      emptyWorkingDays.length === 0 &&
      DEFAULT_WORKING_DAYS.every((day) => (byDay.get(day) ?? []).length >= 7);

    if (complete && !force) {
      skipped += 1;
      console.log(`  ${college.id} ${college.name}: complete (${existing.length} slots) — skipped`);
      continue;
    }

    if (force || existing.length === 0) {
      await replaceTimingSlots(templateId, buildDefaultWeeklySlots(), {
        confirmDestructive: true,
      });
      filled += 1;
      console.log(`  ${college.id} ${college.name}: seeded full P1–P7 Mon–Sat`);
      continue;
    }

    // Partial: keep existing day slots, fill empty working days with default P1–P7
    const next: SlotSaveInput[] = existing.map((s) => ({
      id: s.id,
      dayOfWeek: s.dayOfWeek,
      slotOrder: s.slotOrder,
      label: s.label,
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      slotType: s.slotType,
    }));

    for (const day of emptyWorkingDays) {
      DEFAULT_PERIOD_TIMES.forEach((period, index) => {
        next.push({
          dayOfWeek: day,
          slotOrder: index + 1,
          label: period.label,
          startTime: period.startTime,
          endTime: period.endTime,
          slotType: period.slotType,
        });
      });
    }

    // Top up days that have some but fewer than 7 periods
    for (const day of DEFAULT_WORKING_DAYS) {
      if (emptyWorkingDays.includes(day)) continue;
      const daySlots = [...(byDay.get(day) ?? [])].sort(
        (a, b) => a.slotOrder - b.slotOrder,
      );
      if (daySlots.length >= 7) continue;
      let order = Math.max(...daySlots.map((s) => s.slotOrder), 0);
      for (let i = daySlots.length; i < 7; i += 1) {
        const period =
          DEFAULT_PERIOD_TIMES[i] ??
          DEFAULT_PERIOD_TIMES[DEFAULT_PERIOD_TIMES.length - 1];
        order += 1;
        next.push({
          dayOfWeek: day,
          slotOrder: order,
          label: period.label,
          startTime: period.startTime,
          endTime: period.endTime,
          slotType: period.slotType,
        });
      }
    }

    await replaceTimingSlots(templateId, next, { confirmDestructive: true });
    const detail = await getTimingTemplateDetail(templateId);
    filled += 1;
    console.log(
      `  ${college.id} ${college.name}: filled missing days → ${detail?.slotCount ?? next.length} slots`,
    );
  }

  console.log(
    `\nDone. templatesCreated=${created} updated=${filled} skippedExisting=${skipped}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
