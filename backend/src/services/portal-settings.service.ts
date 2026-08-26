import type { RowDataPacket } from "mysql2";
import {
  getHrmsDb,
  executeAcademic,
  queryAcademic,
  withAcademicTransaction,
} from "../db/pools.js";
import {
  extractHrmsStaffProfile,
  HRMS_EMPLOYEE_PROJECTION,
  isTeachingGroup,
  listHrmsEmployeeGroups,
  loadHrmsOrgLookups,
} from "./hrms-staff.service.js";

export type FacultyGroupOption = {
  id: string;
  name: string;
  enabled: boolean;
  employeeCount: number;
  isTeachingDefault: boolean;
};

export type FacultyGroupFilter = {
  /** True when settings were saved at least once. */
  configured: boolean;
  enabledIds: Set<string>;
  enabledNames: Set<string>;
};

type EnabledGroupRow = RowDataPacket & {
  hrms_group_id: string;
  group_name: string;
  is_enabled: number;
};

let tableReady: Promise<void> | null = null;

async function ensureFacultyGroupTable() {
  if (!tableReady) {
    tableReady = executeAcademic(`
      CREATE TABLE IF NOT EXISTS ap_faculty_enabled_groups (
        hrms_group_id VARCHAR(64) NOT NULL PRIMARY KEY,
        group_name VARCHAR(255) NOT NULL,
        is_enabled TINYINT(1) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_faculty_group_enabled (is_enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).then(() => undefined);
  }
  await tableReady;
}

function normalizeGroupName(name: string) {
  return name.trim().toUpperCase();
}

/** Resolve which HRMS groups are allowed on Faculty & Departments. */
const FACULTY_GROUP_FILTER_TTL_MS = 60 * 1000;
let facultyGroupFilterCache:
  | { expiresAt: number; value: FacultyGroupFilter }
  | null = null;

export function invalidateFacultyGroupFilterCache() {
  facultyGroupFilterCache = null;
}

export async function getFacultyGroupFilter(): Promise<FacultyGroupFilter> {
  if (facultyGroupFilterCache && facultyGroupFilterCache.expiresAt > Date.now()) {
    return facultyGroupFilterCache.value;
  }

  await ensureFacultyGroupTable();
  const rows = await queryAcademic<EnabledGroupRow[]>(
    `SELECT hrms_group_id, group_name, is_enabled FROM ap_faculty_enabled_groups`,
  );

  let value: FacultyGroupFilter;
  if (rows.length > 0) {
    const enabledIds = new Set<string>();
    const enabledNames = new Set<string>();
    for (const row of rows) {
      if (!Number(row.is_enabled)) continue;
      enabledIds.add(String(row.hrms_group_id));
      const name = normalizeGroupName(row.group_name ?? "");
      if (name) enabledNames.add(name);
    }
    value = { configured: true, enabledIds, enabledNames };
  } else {
    // Default (never saved): teaching groups only
    const db = await getHrmsDb();
    const groups = await listHrmsEmployeeGroups(db);
    const enabledIds = new Set<string>();
    const enabledNames = new Set<string>();
    for (const group of groups) {
      if (!isTeachingGroup(group.name)) continue;
      enabledIds.add(group.id);
      enabledNames.add(normalizeGroupName(group.name));
    }
    value = { configured: false, enabledIds, enabledNames };
  }

  facultyGroupFilterCache = {
    expiresAt: Date.now() + FACULTY_GROUP_FILTER_TTL_MS,
    value,
  };
  return value;
}

export function employeeMatchesFacultyGroupFilter(
  filter: FacultyGroupFilter,
  employeeGroupId: string | null,
  employeeGroupName: string,
): boolean {
  if (employeeGroupId && filter.enabledIds.has(employeeGroupId)) return true;
  const name = normalizeGroupName(employeeGroupName);
  if (name && name !== "—" && filter.enabledNames.has(name)) return true;
  return false;
}

export async function getFacultyDisplaySettings() {
  await ensureFacultyGroupTable();
  const db = await getHrmsDb();
  const [groups, lookups, savedRows] = await Promise.all([
    listHrmsEmployeeGroups(db),
    loadHrmsOrgLookups(db),
    queryAcademic<EnabledGroupRow[]>(
      `SELECT hrms_group_id, group_name, is_enabled FROM ap_faculty_enabled_groups`,
    ),
  ]);

  const savedMap = new Map(
    savedRows.map((row) => [
      String(row.hrms_group_id),
      {
        enabled: Number(row.is_enabled) === 1,
        name: row.group_name,
      },
    ]),
  );
  const configured = savedRows.length > 0;

  const employees = await db
    .collection("employees")
    .find({
      $or: [{ is_active: true }, { is_active: { $exists: false } }],
    })
    .project(HRMS_EMPLOYEE_PROJECTION)
    .limit(2000)
    .toArray();

  const counts = new Map<string, number>();
  for (const raw of employees) {
    const emp = extractHrmsStaffProfile(raw as Record<string, unknown>, lookups);
    if (emp.employeeGroupId) {
      counts.set(emp.employeeGroupId, (counts.get(emp.employeeGroupId) ?? 0) + 1);
    }
  }

  const options: FacultyGroupOption[] = groups.map((group) => {
    const teachingDefault = isTeachingGroup(group.name);
    const saved = savedMap.get(group.id);
    return {
      id: group.id,
      name: group.name,
      enabled: configured ? Boolean(saved?.enabled) : teachingDefault,
      employeeCount: counts.get(group.id) ?? 0,
      isTeachingDefault: teachingDefault,
    };
  });

  options.sort((a, b) => a.name.localeCompare(b.name));

  const enabledCount = options.filter((g) => g.enabled).length;

  return {
    groups: options,
    enabledCount,
    totalGroups: options.length,
    usingDefaults: !configured,
    description:
      "Enable the HRMS employee groups that should appear on Faculty & Departments. Disabled groups are hidden from that list.",
  };
}

export async function setFacultyEnabledGroups(enabledGroupIds: string[]) {
  if (!Array.isArray(enabledGroupIds)) {
    throw new Error("enabledGroupIds must be an array");
  }

  await ensureFacultyGroupTable();
  const db = await getHrmsDb();
  const groups = await listHrmsEmployeeGroups(db);
  const enabledSet = new Set(
    enabledGroupIds.map((id) => String(id).trim()).filter(Boolean),
  );

  await withAcademicTransaction(async (conn) => {
    await conn.query(`DELETE FROM ap_faculty_enabled_groups`);
    if (groups.length === 0) return;

    const placeholders = groups.map(() => "(?, ?, ?)").join(", ");
    const params = groups.flatMap((group) => [
      group.id,
      group.name,
      enabledSet.has(group.id) ? 1 : 0,
    ]);
    await conn.query(
      `
      INSERT INTO ap_faculty_enabled_groups (hrms_group_id, group_name, is_enabled)
      VALUES ${placeholders}
      `,
      params,
    );
  });

  const { invalidateFacultyRowsCache } = await import("./faculty.service.js");
  invalidateFacultyRowsCache();
  invalidateFacultyGroupFilterCache();

  return getFacultyDisplaySettings();
}
