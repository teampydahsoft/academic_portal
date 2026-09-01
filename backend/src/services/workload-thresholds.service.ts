import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { executeAcademic, queryAcademic, queryStudent, withAcademicTransaction } from "../db/pools.js";

export type WorkloadThresholds = {
  minPeriodsPerWeek: number;
  maxPeriodsPerWeek: number;
  maxPeriodsPerDay: number;
  minHoursPerWeek: number | null;
  maxHoursPerWeek: number | null;
};

export const DEFAULT_WORKLOAD_THRESHOLDS: WorkloadThresholds = {
  minPeriodsPerWeek: 8,
  maxPeriodsPerWeek: 20,
  maxPeriodsPerDay: 5,
  minHoursPerWeek: 16,
  maxHoursPerWeek: null,
};

type ThresholdRow = RowDataPacket & {
  id: number;
  college_id: number | null;
  min_periods_per_week: number;
  max_periods_per_week: number;
  max_periods_per_day: number;
  min_hours_per_week: number | null;
  max_hours_per_week: number | null;
  is_active: number;
};

let tableReady: Promise<void> | null = null;

async function columnExists(table: string, column: string) {
  const rows = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `
    SELECT COUNT(*) AS c
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
    `,
    [table, column],
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

async function ensureWorkloadThresholdsTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await executeAcademic(`
        CREATE TABLE IF NOT EXISTS ap_workload_thresholds (
          id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
          college_id INT NULL,
          branch_id INT NULL,
          min_periods_per_week INT NOT NULL DEFAULT 8,
          max_periods_per_week INT NOT NULL DEFAULT 20,
          max_periods_per_day INT NOT NULL DEFAULT 5,
          min_hours_per_week DECIMAL(6,2) NULL,
          max_hours_per_week DECIMAL(6,2) NULL,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      if (!(await columnExists("ap_workload_thresholds", "min_hours_per_week"))) {
        await executeAcademic(
          `ALTER TABLE ap_workload_thresholds ADD COLUMN min_hours_per_week DECIMAL(6,2) NULL AFTER max_periods_per_day`,
        );
      }
      if (!(await columnExists("ap_workload_thresholds", "max_hours_per_week"))) {
        await executeAcademic(
          `ALTER TABLE ap_workload_thresholds ADD COLUMN max_hours_per_week DECIMAL(6,2) NULL AFTER min_hours_per_week`,
        );
      }
    })();
  }
  await tableReady;
}

function mapRow(row: ThresholdRow): WorkloadThresholds {
  return {
    minPeriodsPerWeek: Number(row.min_periods_per_week) || DEFAULT_WORKLOAD_THRESHOLDS.minPeriodsPerWeek,
    maxPeriodsPerWeek: Number(row.max_periods_per_week) || DEFAULT_WORKLOAD_THRESHOLDS.maxPeriodsPerWeek,
    maxPeriodsPerDay: Number(row.max_periods_per_day) || DEFAULT_WORKLOAD_THRESHOLDS.maxPeriodsPerDay,
    minHoursPerWeek:
      row.min_hours_per_week == null ? null : Number(row.min_hours_per_week),
    maxHoursPerWeek:
      row.max_hours_per_week == null ? null : Number(row.max_hours_per_week),
  };
}

export async function loadWorkloadThresholds(collegeId?: number): Promise<WorkloadThresholds> {
  await ensureWorkloadThresholdsTable();
  try {
    const rows = await queryAcademic<ThresholdRow[]>(
      `
      SELECT id, college_id, min_periods_per_week, max_periods_per_week, max_periods_per_day,
             min_hours_per_week, max_hours_per_week, is_active
      FROM ap_workload_thresholds
      WHERE is_active = 1
        AND (college_id IS NULL OR college_id = ?)
      ORDER BY (college_id IS NULL) ASC, id DESC
      LIMIT 1
      `,
      [collegeId ?? null],
    );
    const row = rows[0];
    if (!row) return { ...DEFAULT_WORKLOAD_THRESHOLDS };
    return mapRow(row);
  } catch {
    return { ...DEFAULT_WORKLOAD_THRESHOLDS };
  }
}

export function evaluateWorkloadStatus(
  periodsPerWeek: number,
  hoursPerWeek: number,
  maxPeriodsInADay: number,
  thresholds: WorkloadThresholds,
): "Overloaded" | "Underloaded" | "Balanced" {
  if (periodsPerWeek > thresholds.maxPeriodsPerWeek) return "Overloaded";
  if (thresholds.maxHoursPerWeek != null && hoursPerWeek > thresholds.maxHoursPerWeek) {
    return "Overloaded";
  }
  if (maxPeriodsInADay > thresholds.maxPeriodsPerDay) return "Overloaded";

  if (periodsPerWeek < thresholds.minPeriodsPerWeek) return "Underloaded";
  if (thresholds.minHoursPerWeek != null && hoursPerWeek < thresholds.minHoursPerWeek) {
    return "Underloaded";
  }

  return "Balanced";
}

function parseOptionalHours(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export type WorkloadThresholdSettingsResponse = {
  collegeId: number | null;
  thresholds: WorkloadThresholds;
  usingDefaults: boolean;
  colleges: Array<{ id: number; name: string; hasOverride: boolean }>;
  description: string;
};

export async function getWorkloadThresholdSettings(
  collegeId?: number | null,
): Promise<WorkloadThresholdSettingsResponse> {
  await ensureWorkloadThresholdsTable();

  const [collegeRows, overrideRows, scopedRows, globalRows] = await Promise.all([
    queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM colleges ORDER BY name`,
    ),
    queryAcademic<(RowDataPacket & { college_id: number | null })[]>(
      `
      SELECT DISTINCT college_id
      FROM ap_workload_thresholds
      WHERE is_active = 1 AND college_id IS NOT NULL
      `,
    ),
    collegeId != null
      ? queryAcademic<ThresholdRow[]>(
          `
          SELECT id, college_id, min_periods_per_week, max_periods_per_week, max_periods_per_day,
                 min_hours_per_week, max_hours_per_week, is_active
          FROM ap_workload_thresholds
          WHERE is_active = 1 AND college_id = ?
          ORDER BY id DESC
          LIMIT 1
          `,
          [collegeId],
        )
      : Promise.resolve([] as ThresholdRow[]),
    queryAcademic<ThresholdRow[]>(
      `
      SELECT id, college_id, min_periods_per_week, max_periods_per_week, max_periods_per_day,
             min_hours_per_week, max_hours_per_week, is_active
      FROM ap_workload_thresholds
      WHERE is_active = 1 AND college_id IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
    ),
  ]);

  const overrideCollegeIds = new Set(
    overrideRows.map((row) => Number(row.college_id)).filter((id) => id > 0),
  );

  const activeRow = scopedRows[0] ?? globalRows[0] ?? null;
  const thresholds = activeRow ? mapRow(activeRow) : { ...DEFAULT_WORKLOAD_THRESHOLDS };
  const usingDefaults = !activeRow;

  return {
    collegeId: collegeId ?? null,
    thresholds,
    usingDefaults,
    colleges: collegeRows.map((college) => ({
      id: Number(college.id),
      name: String(college.name),
      hasOverride: overrideCollegeIds.has(Number(college.id)),
    })),
    description:
      "Staff workload status (Underloaded / Balanced / Overloaded) uses these limits from published timetables. Set a college override or leave college as “All colleges” for the global default.",
  };
}

export async function saveWorkloadThresholdSettings(input: {
  collegeId?: number | null;
  minPeriodsPerWeek: number;
  maxPeriodsPerWeek: number;
  maxPeriodsPerDay: number;
  minHoursPerWeek?: number | null;
  maxHoursPerWeek?: number | null;
}) {
  await ensureWorkloadThresholdsTable();

  const collegeId = input.collegeId == null || input.collegeId === 0 ? null : Number(input.collegeId);
  const thresholds: WorkloadThresholds = {
    minPeriodsPerWeek: parsePositiveInt(
      input.minPeriodsPerWeek,
      DEFAULT_WORKLOAD_THRESHOLDS.minPeriodsPerWeek,
    ),
    maxPeriodsPerWeek: parsePositiveInt(
      input.maxPeriodsPerWeek,
      DEFAULT_WORKLOAD_THRESHOLDS.maxPeriodsPerWeek,
    ),
    maxPeriodsPerDay: parsePositiveInt(
      input.maxPeriodsPerDay,
      DEFAULT_WORKLOAD_THRESHOLDS.maxPeriodsPerDay,
    ),
    minHoursPerWeek: parseOptionalHours(input.minHoursPerWeek),
    maxHoursPerWeek: parseOptionalHours(input.maxHoursPerWeek),
  };

  if (thresholds.minPeriodsPerWeek > thresholds.maxPeriodsPerWeek) {
    throw Object.assign(new Error("Minimum periods cannot exceed maximum periods"), { status: 400 });
  }
  if (
    thresholds.minHoursPerWeek != null &&
    thresholds.maxHoursPerWeek != null &&
    thresholds.minHoursPerWeek > thresholds.maxHoursPerWeek
  ) {
    throw Object.assign(new Error("Minimum hours cannot exceed maximum hours"), { status: 400 });
  }

  await withAcademicTransaction(async (conn: PoolConnection) => {
    if (collegeId == null) {
      await conn.execute(
        `UPDATE ap_workload_thresholds SET is_active = 0 WHERE college_id IS NULL AND is_active = 1`,
      );
    } else {
      await conn.execute(
        `UPDATE ap_workload_thresholds SET is_active = 0 WHERE college_id = ? AND is_active = 1`,
        [collegeId],
      );
    }

    await conn.execute(
      `
      INSERT INTO ap_workload_thresholds
        (college_id, min_periods_per_week, max_periods_per_week, max_periods_per_day,
         min_hours_per_week, max_hours_per_week, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
      `,
      [
        collegeId,
        thresholds.minPeriodsPerWeek,
        thresholds.maxPeriodsPerWeek,
        thresholds.maxPeriodsPerDay,
        thresholds.minHoursPerWeek,
        thresholds.maxHoursPerWeek,
      ],
    );
  });

  return getWorkloadThresholdSettings(collegeId);
}
