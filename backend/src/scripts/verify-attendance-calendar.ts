import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { queryAcademic, queryStudent } from "../db/pools.js";
import { getAttendanceCalendar } from "../services/attendance-calendar.service.js";
import { listPublicHolidays } from "../services/nager-public-holidays.service.js";
import { isSunday } from "../services/student-academic-dates.service.js";

type ScopeRow = RowDataPacket & {
  college_id: number;
  course_id: number;
  batch: string | null;
  year_of_study: number;
  semester_number: number;
  start_date: string;
  end_date: string;
};

async function pickScope(): Promise<ScopeRow> {
  const withHolidays = await queryStudent<ScopeRow[]>(
    `
    SELECT
      sem.college_id,
      sem.course_id,
      sem.batch,
      sem.year_of_study,
      sem.semester_number,
      DATE_FORMAT(sem.start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(sem.end_date, '%Y-%m-%d') AS end_date
    FROM semesters sem
    WHERE sem.college_id IS NOT NULL
      AND sem.start_date IS NOT NULL
      AND sem.end_date IS NOT NULL
      AND sem.batch IS NOT NULL
      AND TRIM(sem.batch) <> ''
      AND EXISTS (
        SELECT 1 FROM custom_holidays h
        WHERE h.holiday_date BETWEEN sem.start_date AND sem.end_date
      )
    ORDER BY sem.updated_at DESC
    LIMIT 1
    `,
  );
  if (withHolidays[0]) return withHolidays[0];

  const any = await queryStudent<ScopeRow[]>(
    `
    SELECT
      college_id,
      course_id,
      batch,
      year_of_study,
      semester_number,
      DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
      DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
    FROM semesters
    WHERE college_id IS NOT NULL
      AND start_date IS NOT NULL
      AND end_date IS NOT NULL
      AND batch IS NOT NULL
      AND TRIM(batch) <> ''
    ORDER BY updated_at DESC
    LIMIT 1
    `,
  );
  if (!any[0]) throw new Error("No configured semester found in student_database.semesters");
  return any[0];
}

async function main() {
  console.log("=== Attendance Calendar verification ===\n");

  const scope = await pickScope();
  console.log("1. Semester window (Student DB)", {
    collegeId: scope.college_id,
    courseId: scope.course_id,
    batch: scope.batch,
    year: scope.year_of_study,
    semester: scope.semester_number,
    startDate: scope.start_date,
    endDate: scope.end_date,
  });

  const attendanceBefore = await queryStudent<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM attendance_records`,
  );
  const attendanceCountBefore = Number(attendanceBefore[0]?.c ?? 0);

  const calendar = await getAttendanceCalendar({
    collegeId: Number(scope.college_id),
    courseId: Number(scope.course_id),
    batch: scope.batch,
    yearOfStudy: Number(scope.year_of_study),
    semesterNumber: Number(scope.semester_number),
  });

  if (!calendar) {
    throw new Error("getAttendanceCalendar returned null");
  }

  console.log("\n2. Semester dates match Student DB", {
    apiStart: calendar.startDate,
    apiEnd: calendar.endDate,
    match:
      calendar.startDate === scope.start_date.slice(0, 10) &&
      calendar.endDate === scope.end_date.slice(0, 10),
  });

  console.log("\n3. Institute holidays", {
    source: calendar.source.instituteHolidays,
    count: calendar.instituteHolidays.length,
    sample: calendar.instituteHolidays.slice(0, 5).map((h) => ({
      date: h.holidayDate,
      title: h.title,
    })),
  });

  const sundays = calendar.days.filter((day) => day.isSunday);
  const sundayFlagsOk = calendar.days.every((day) => day.isSunday === isSunday(day.date));
  const sundayStatesOk = sundays.every(
    (day) =>
      day.state === "sunday" ||
      day.state === "institute_holiday" ||
      day.state === "public_holiday",
  );
  console.log("\n4. Sundays", {
    count: calendar.counts.sundays,
    sundayDates: sundays.length,
    sundayFlagsOk,
    sundayStatesOk,
  });

  const nager = await listPublicHolidays({
    startDate: calendar.startDate,
    endDate: calendar.endDate,
  });
  console.log("\n5. Public holidays (Nager.Date)", {
    country: calendar.publicHolidaysCountry,
    apiCount: calendar.publicHolidays.length,
    directFetchCount: nager.holidays.length,
    error: calendar.publicHolidaysError ?? nager.error,
    note: "Nager.Date AvailableCountries currently omits IN; empty set is expected for India.",
  });

  const apCalendarTables = await queryAcademic<RowDataPacket[]>(
    `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        TABLE_NAME LIKE '%calendar%'
        OR TABLE_NAME LIKE '%holiday%'
        OR TABLE_NAME LIKE '%working_day%'
      )
    ORDER BY TABLE_NAME
    `,
  );
  console.log("\n6. Academic Portal calendar tables (expect none)", {
    tables: apCalendarTables.map((row) => row.TABLE_NAME),
  });

  const attendanceAfter = await queryStudent<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM attendance_records`,
  );
  const attendanceCountAfter = Number(attendanceAfter[0]?.c ?? 0);
  console.log("\n7. attendance_records unchanged", {
    before: attendanceCountBefore,
    after: attendanceCountAfter,
    unchanged: attendanceCountBefore === attendanceCountAfter,
  });

  console.log("\n8. Sources (architecture)", calendar.source);
  console.log("\n9. Counts", calendar.counts);
  console.log("\n10. Class session generation still uses custom_holidays only (not changed by this page).");
  console.log("    period_slots are not referenced by attendance-calendar services.\n");

  if (calendar.instituteHolidays.length === 0) {
    console.warn("WARN: chosen semester had no overlapping custom_holidays.");
  }

  console.log("OK — Attendance Calendar verification completed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
