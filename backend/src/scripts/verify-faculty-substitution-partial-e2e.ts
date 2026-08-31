/**
 * Safe partial E2E checks for faculty substitution without mutating timetable publish state.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { queryAcademic } from "../db/pools.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";

const base = `http://127.0.0.1:${env.port}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, setCookie: response.headers.getSetCookie?.() ?? [] };
}

function extractSid(setCookie: string[]) {
  const prefix = `${env.auth.cookieName}=`;
  for (const line of setCookie) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).split(";")[0];
  }
  return null;
}

async function login() {
  const result = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      identifier: SUPER_ADMIN_SEED.username,
      password: SUPER_ADMIN_SEED.password,
    }),
  });
  assert(result.status === 200, `Superadmin login failed: ${result.status}`);
  const sid = extractSid(result.setCookie);
  assert(sid, "Missing session cookie");
  return `${env.auth.cookieName}=${sid}`;
}

async function main() {
  console.log("=== Faculty substitution partial E2E verification ===\n");

  const published = await queryAcademic<(RowDataPacket & { c: number })[]>(`
    SELECT COUNT(*) c FROM ap_timetable_plans WHERE status = 'published'
  `);
  const publishedCount = Number(published[0]?.c ?? 0);
  console.log(`Published timetable plans: ${publishedCount}`);

  const cookie = await login();
  console.log("1. Authenticated as superadmin");

  const types = await req("/api/requests/types", { cookie });
  assert(types.status === 200, "Request types failed");
  const typeKeys = ((types.json as { data: { typeKey: string }[] }).data ?? []).map((t) => t.typeKey);
  assert(typeKeys.includes("faculty_substitution"), "faculty_substitution type missing");
  assert(typeKeys.includes("general_academic"), "general_academic type missing");
  console.log("2. Request types include faculty_substitution and general_academic");

  const inReview = await queryAcademic<
    (RowDataPacket & {
      id: number;
      college_id: number;
      course_id: number;
      branch_id: number;
      batch: string;
      year_of_study: number | null;
      semester_number: number | null;
      section_name: string | null;
      academic_year_label: string;
      timing_slot_id: string;
      day_of_week: string;
    })[]
  >(`
    SELECT p.id, p.college_id, p.course_id, p.branch_id, p.batch, p.year_of_study,
           p.semester_number, p.section_name, p.academic_year_label,
           COALESCE(e.timing_slot_id, e.period_slot_id) AS timing_slot_id,
           e.day_of_week
    FROM ap_timetable_plans p
    INNER JOIN ap_timetable_entries e ON e.plan_id = p.id
    WHERE p.status = 'in_review' AND e.subject_id IS NOT NULL AND e.faculty_staff_link_id IS NOT NULL
    LIMIT 1
  `);

  if (inReview[0]) {
    const plan = inReview[0];
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (["SUN", "SAT"].includes(["SUN", "MON", "TUE", "WED", "THUR", "FRI", "SAT"][d.getDay()]!)) {
      d.setDate(d.getDate() + 1);
    }
    const sessionDate = d.toISOString().slice(0, 10);
    const resolve = await req("/api/faculty-substitutions/resolve-class", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        sessionDate,
        collegeId: plan.college_id,
        courseId: plan.course_id,
        branchId: plan.branch_id,
        batch: plan.batch,
        yearOfStudy: plan.year_of_study,
        semesterNumber: plan.semester_number,
        sectionName: plan.section_name ?? "A",
        timingSlotId: Number(plan.timing_slot_id),
        academicYear: plan.academic_year_label,
      }),
    });
    assert(resolve.status === 404, `Unpublished timetable must not resolve, got ${resolve.status}`);
    console.log("3. Unpublished timetable correctly rejected by resolve-class");
  } else {
    console.log("3. Skipped unpublished resolve check (no in_review entries)");
  }

  if (publishedCount === 0) {
    console.log("\nBLOCKER: No published timetable exists — full substitution apply E2E cannot run.");
    console.log("Publish a timetable plan through Timetables UI, then re-run verify-faculty-substitution-e2e.ts");
    return;
  }

  console.log("\nPublished timetable present — run verify-faculty-substitution-e2e.ts for full apply flow.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
