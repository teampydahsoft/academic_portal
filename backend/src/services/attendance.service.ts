import type { RowDataPacket } from "mysql2";
import {
  executeAcademic,
  queryAcademic,
  queryStudent,
  withAcademicTransaction,
} from "../db/pools.js";
import { ensureStaffLink } from "./timetables.service.js";
import { ensureSessionsForDate } from "./class-sessions.service.js";
import {
  holidayAppliesToScope,
  listCustomHolidays,
  type HolidayScope,
} from "./student-academic-dates.service.js";

export type AttendanceMark = "present" | "absent" | "od" | "leave";

const MARKS: AttendanceMark[] = ["present", "absent", "od", "leave"];

type SessionListRow = RowDataPacket & {
  id: number;
  plan_id: number;
  session_date: string;
  day_of_week: string;
  start_time: string | null;
  end_time: string | null;
  section_name: string | null;
  college_id: number | null;
  course_id: number | null;
  branch_id: number;
  batch: string | null;
  year_of_study: number | null;
  semester_number: number | null;
  subject_id: number | null;
  subject_code: string | null;
  subject_name: string | null;
  subject_type_snapshot: string | null;
  faculty_staff_link_id: number | null;
  faculty_name: string | null;
  room_label: string | null;
  slot_label: string | null;
  status: string;
  post_id: number | null;
  present_count: number | null;
  absent_count: number | null;
  od_count: number | null;
  leave_count: number | null;
};

type StudentRow = RowDataPacket & {
  id: number;
  admission_number: string;
  student_name: string | null;
};

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function asDate(value: string | null | undefined) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function asTime(value: string | null | undefined) {
  if (!value) return null;
  return String(value).slice(0, 5);
}

export type AttendanceListFilters = {
  date?: string;
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  batch?: string;
  year?: number;
  semester?: number;
  section?: string;
  academicYear?: string;
  generate?: boolean;
};

function holidayScopeFromRow(row: {
  college_id?: number | null;
  course_id?: number | null;
  branch_id?: number | null;
  batch?: string | null;
  year_of_study?: number | null;
  semester_number?: number | null;
}): HolidayScope {
  return {
    collegeId: row.college_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    batch: row.batch,
    yearOfStudy: row.year_of_study,
    semesterNumber: row.semester_number,
  };
}

async function ensurePosterUserId() {
  const existing = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = 'academic_portal' LIMIT 1`,
  );
  if (existing[0]?.id) return Number(existing[0].id);
  const inserted = await executeAcademic(
    `INSERT INTO ap_users (name, username, is_active) VALUES (?, ?, 1)`,
    ["Academic Portal System", "academic_portal"],
  );
  return Number(inserted.insertId);
}

function mapSessionCard(row: SessionListRow, holiday: boolean) {
  const posted = row.post_id != null;
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    date: asDate(row.session_date),
    dayOfWeek: row.day_of_week,
    startTime: asTime(row.start_time),
    endTime: asTime(row.end_time),
    slotLabel: row.slot_label,
    subjectId: row.subject_id,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    subjectTypeSnapshot: row.subject_type_snapshot,
    section: row.section_name,
    collegeId: row.college_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    batch: row.batch,
    year: row.year_of_study,
    semester: row.semester_number,
    facultyStaffLinkId: row.faculty_staff_link_id,
    facultyName: row.faculty_name,
    roomLabel: row.room_label,
    sessionStatus: holiday ? "holiday" : posted ? "posted" : row.status,
    posted,
    holiday,
    presentCount: Number(row.present_count ?? 0),
    absentCount: Number(row.absent_count ?? 0),
    odCount: Number(row.od_count ?? 0),
    leaveCount: Number(row.leave_count ?? 0),
  };
}

export async function listAttendanceSessions(filters: AttendanceListFilters) {
  const date = filters.date || todayIso();
  let generated = null as Awaited<ReturnType<typeof ensureSessionsForDate>> | null;

  if (filters.generate !== false) {
    generated = await ensureSessionsForDate(date, {
      collegeId: filters.collegeId,
      courseId: filters.courseId,
      branchId: filters.branchId,
      batch: filters.batch,
      year: filters.year,
      semester: filters.semester,
      section: filters.section,
      academicYear: filters.academicYear,
    });
  }

  const where = ["cs.session_date = ?", "cs.status <> 'cancelled'"];
  const params: unknown[] = [date];

  if (filters.collegeId) {
    where.push("cs.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`cs.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.courseId) {
    where.push("p.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("cs.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`cs.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.batch) {
    where.push("p.batch = ?");
    params.push(filters.batch);
  }
  if (filters.year != null) {
    where.push("p.year_of_study = ?");
    params.push(filters.year);
  }
  if (filters.semester != null) {
    where.push("p.semester_number = ?");
    params.push(filters.semester);
  }
  if (filters.section) {
    where.push("cs.section_name = ?");
    params.push(filters.section);
  }
  if (filters.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(filters.academicYear);
  }

  const rows = await queryAcademic<SessionListRow[]>(
    `
    SELECT
      cs.id,
      cs.plan_id,
      cs.session_date,
      cs.day_of_week,
      cs.start_time,
      cs.end_time,
      cs.section_name,
      cs.college_id,
      p.course_id,
      cs.branch_id,
      p.batch,
      p.year_of_study,
      p.semester_number,
      cs.subject_id,
      cs.subject_code,
      cs.subject_name,
      cs.subject_type_snapshot,
      cs.faculty_staff_link_id,
      sl.display_name AS faculty_name,
      cs.room_label,
      ts.label AS slot_label,
      cs.status,
      ap.id AS post_id,
      ap.present_count,
      ap.absent_count,
      ap.od_count,
      ap.leave_count
    FROM ap_class_sessions cs
    INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
    LEFT JOIN ap_staff_link sl ON sl.id = cs.faculty_staff_link_id
    LEFT JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    LEFT JOIN ap_attendance_posts ap ON ap.class_session_id = cs.id
    WHERE ${where.join(" AND ")}
    ORDER BY cs.start_time, cs.id
    `,
    params,
  );

  const holidays = await listCustomHolidays({ startDate: date, endDate: date });
  const sessions = rows
    .map((row) => {
      const holiday = holidays.some((item) =>
        holidayAppliesToScope(item, holidayScopeFromRow(row)),
      );
      return mapSessionCard(row, holiday);
    })
    .filter((session) => !session.holiday);

  return {
    date,
    source: {
      sessions: "academic_portal.ap_class_sessions",
      holidays: "student_database.custom_holidays",
      students: "student_database.students",
    },
    generated,
    scheduled: sessions.filter((s) => !s.posted).length,
    posted: sessions.filter((s) => s.posted).length,
    data: sessions,
  };
}

async function loadSessionContext(sessionId: number) {
  const rows = await queryAcademic<SessionListRow[]>(
    `
    SELECT
      cs.id,
      cs.plan_id,
      cs.session_date,
      cs.day_of_week,
      cs.start_time,
      cs.end_time,
      cs.section_name,
      cs.college_id,
      p.course_id,
      cs.branch_id,
      p.batch,
      p.year_of_study,
      p.semester_number,
      cs.subject_id,
      cs.subject_code,
      cs.subject_name,
      cs.subject_type_snapshot,
      cs.faculty_staff_link_id,
      sl.display_name AS faculty_name,
      cs.room_label,
      ts.label AS slot_label,
      cs.status,
      ap.id AS post_id,
      ap.present_count,
      ap.absent_count,
      ap.od_count,
      ap.leave_count
    FROM ap_class_sessions cs
    INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
    LEFT JOIN ap_staff_link sl ON sl.id = cs.faculty_staff_link_id
    LEFT JOIN ap_timing_template_slots ts
      ON ts.id = COALESCE(cs.timing_slot_id, cs.period_slot_id)
    LEFT JOIN ap_attendance_posts ap ON ap.class_session_id = cs.id
    WHERE cs.id = ?
    LIMIT 1
    `,
    [sessionId],
  );
  return rows[0] ?? null;
}

async function loadRosterStudents(row: SessionListRow) {
  const where = [
    "s.branch_id = ?",
    `(s.student_status IS NULL OR LOWER(s.student_status) NOT IN ('relieved','discontinued','inactive','cancelled'))`,
  ];
  const params: unknown[] = [row.branch_id];

  if (row.batch) {
    where.push("TRIM(s.batch) = ?");
    params.push(row.batch);
  }
  if (row.college_id != null) {
    where.push("s.college_id = ?");
    params.push(row.college_id);
  }
  if (row.course_id != null) {
    where.push("s.course_id = ?");
    params.push(row.course_id);
  }
  if (row.year_of_study != null) {
    where.push("s.current_year = ?");
    params.push(row.year_of_study);
  }
  if (row.semester_number != null) {
    where.push("s.current_semester = ?");
    params.push(row.semester_number);
  }
  if (row.section_name) {
    where.push(`
      TRIM(COALESCE(
        ss.section_name COLLATE utf8mb4_unicode_ci,
        s.section COLLATE utf8mb4_unicode_ci,
        '' COLLATE utf8mb4_unicode_ci
      )) = TRIM(?) COLLATE utf8mb4_unicode_ci
    `);
    params.push(row.section_name);
  }

  return queryStudent<StudentRow[]>(
    `
    SELECT s.id, s.admission_number, s.student_name
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id, s.admission_number, s.student_name
    ORDER BY s.student_name
    LIMIT 500
    `,
    params,
  );
}

export async function getAttendanceSession(sessionId: number) {
  const row = await loadSessionContext(sessionId);
  if (!row) {
    throw Object.assign(new Error("Class session not found"), { status: 404 });
  }
  if (row.status === "cancelled") {
    throw Object.assign(new Error("This class session is cancelled"), { status: 400 });
  }

  const date = asDate(row.session_date)!;
  const holidays = await listCustomHolidays({
    startDate: date,
    endDate: date,
    scope: holidayScopeFromRow(row),
  });
  if (holidays.length > 0 || row.status === "holiday") {
    throw Object.assign(
      new Error(
        `Cannot post attendance: ${date} is a declared holiday (${holidays[0]?.title ?? "holiday"})`,
      ),
      { status: 400 },
    );
  }

  const [students, marks] = await Promise.all([
    loadRosterStudents(row),
    row.post_id
      ? queryAcademic<
          (RowDataPacket & {
            student_db_id: number;
            status: AttendanceMark;
            remarks: string | null;
          })[]
        >(
          `SELECT student_db_id, status, remarks FROM ap_attendance_post_students WHERE attendance_post_id = ?`,
          [row.post_id],
        )
      : Promise.resolve([]),
  ]);

  const markByStudent = new Map(marks.map((m) => [Number(m.student_db_id), m]));
  const mapped = mapSessionCard(row, false);

  return {
    session: {
      ...mapped,
      time: [mapped.startTime, mapped.endTime].filter(Boolean).join(" – ") || "—",
      studentCount: students.length,
    },
    posted: Boolean(row.post_id),
    students: students.map((student) => {
      const existing = markByStudent.get(Number(student.id));
      return {
        id: String(student.id),
        studentDbId: Number(student.id),
        name: student.student_name ?? "Unknown",
        admissionNo: student.admission_number,
        status: (existing?.status ?? "present") as AttendanceMark,
        remarks: existing?.remarks ?? null,
      };
    }),
  };
}

export async function postAttendance(
  sessionId: number,
  input: {
    students: Array<{
      studentDbId: number;
      admissionNumber?: string;
      status: AttendanceMark;
      remarks?: string | null;
    }>;
    editReason?: string | null;
    /** Authenticated Academic Portal user id. Falls back to system user only when omitted (jobs). */
    postedByUserId?: number | null;
  },
) {
  const row = await loadSessionContext(sessionId);
  if (!row) {
    throw Object.assign(new Error("Class session not found"), { status: 404 });
  }
  if (row.status === "cancelled") {
    throw Object.assign(new Error("This class session is cancelled"), { status: 400 });
  }

  const date = asDate(row.session_date)!;
  const holidays = await listCustomHolidays({
    startDate: date,
    endDate: date,
    scope: holidayScopeFromRow(row),
  });
  if (holidays.length > 0 || row.status === "holiday") {
    throw Object.assign(
      new Error(`Cannot post attendance on a declared holiday (${date})`),
      { status: 400 },
    );
  }

  if (row.post_id && !input.editReason?.trim()) {
    throw Object.assign(
      new Error("Attendance already posted. Provide editReason to update."),
      { status: 409 },
    );
  }

  const roster = await loadRosterStudents(row);
  const rosterById = new Map(roster.map((s) => [Number(s.id), s]));
  if (!input.students?.length) {
    throw Object.assign(new Error("Student marks are required"), { status: 400 });
  }

  const marks = input.students.map((item) => {
    const student = rosterById.get(Number(item.studentDbId));
    if (!student) {
      throw Object.assign(
        new Error(`Student ${item.studentDbId} is not on this class roster`),
        { status: 400 },
      );
    }
    if (!MARKS.includes(item.status)) {
      throw Object.assign(new Error(`Invalid status: ${item.status}`), { status: 400 });
    }
    return {
      studentDbId: Number(student.id),
      admissionNumber: student.admission_number,
      status: item.status,
      remarks: item.remarks ?? null,
    };
  });

  const present = marks.filter((m) => m.status === "present").length;
  const absent = marks.filter((m) => m.status === "absent").length;
  const od = marks.filter((m) => m.status === "od").length;
  const leave = marks.filter((m) => m.status === "leave").length;

  const posterUserId =
    input.postedByUserId != null && Number.isFinite(Number(input.postedByUserId))
      ? Number(input.postedByUserId)
      : await ensurePosterUserId();
  const staffLinkId =
    row.faculty_staff_link_id ??
    (await ensureStaffLink({
      hrmsEmployeeId: "academic-portal-unassigned",
      displayName: "Unassigned faculty",
    }));

  const postId = await withAcademicTransaction(async (conn) => {
    let id = row.post_id ? Number(row.post_id) : null;
    if (!id) {
      const [insertResult] = await conn.execute(
        `
        INSERT INTO ap_attendance_posts
          (class_session_id, posted_by_user_id, posted_by_staff_link_id, posted_at,
           present_count, absent_count, od_count, leave_count, is_locked)
        VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, 1)
        `,
        [sessionId, posterUserId, staffLinkId, present, absent, od, leave],
      );
      id = Number((insertResult as { insertId: number }).insertId);
    } else {
      await conn.execute(
        `
        UPDATE ap_attendance_posts
        SET present_count = ?, absent_count = ?, od_count = ?, leave_count = ?,
            edit_reason = ?, posted_at = NOW(), posted_by_user_id = ?,
            posted_by_staff_link_id = ?
        WHERE id = ?
        `,
        [present, absent, od, leave, input.editReason ?? null, posterUserId, staffLinkId, id],
      );
      await conn.execute(
        `DELETE FROM ap_attendance_post_students WHERE attendance_post_id = ?`,
        [id],
      );
    }

    for (const mark of marks) {
      await conn.execute(
        `
        INSERT INTO ap_attendance_post_students
          (attendance_post_id, student_db_id, admission_number, status, remarks)
        VALUES (?, ?, ?, ?, ?)
        `,
        [id, mark.studentDbId, mark.admissionNumber, mark.status, mark.remarks],
      );
    }

    await conn.execute(
      `UPDATE ap_class_sessions SET status = 'posted' WHERE id = ?`,
      [sessionId],
    );

    return id;
  });

  return {
    postId,
    classSessionId: sessionId,
    present,
    absent,
    od,
    leave,
    total: marks.length,
  };
}

export async function getAttendanceAnalytics(filters: {
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  section?: string;
} = {}) {
  const where = ["cs.session_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)"];
  const params: unknown[] = [];
  if (filters.collegeId) {
    where.push("cs.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`cs.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.courseId) {
    where.push("p.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.branchId) {
    where.push("cs.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`cs.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.section) {
    where.push("cs.section_name = ?");
    params.push(filters.section);
  }

  const fromSql = `
    FROM ap_attendance_post_students aps
    INNER JOIN ap_attendance_posts ap ON ap.id = aps.attendance_post_id
    INNER JOIN ap_class_sessions cs ON cs.id = ap.class_session_id
    INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
    WHERE ${where.join(" AND ")}
  `;

  const todayWhere = ["cs.status NOT IN ('cancelled','holiday')"];
  const todayParams: unknown[] = [];
  if (filters.collegeId) {
    todayWhere.push("cs.college_id = ?");
    todayParams.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    todayWhere.push(`cs.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    todayParams.push(...filters.collegeIds);
  }
  if (filters.courseId) {
    todayWhere.push("p.course_id = ?");
    todayParams.push(filters.courseId);
  }
  if (filters.branchId) {
    todayWhere.push("cs.branch_id = ?");
    todayParams.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    todayWhere.push(`cs.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    todayParams.push(...filters.branchIds);
  }
  if (filters.section) {
    todayWhere.push("cs.section_name = ?");
    todayParams.push(filters.section);
  }

  const [overallRows, bandRows, sectionRows, pendingRows] = await Promise.all([
    queryAcademic<(RowDataPacket & { avg_pct: number | null })[]>(
      `
      SELECT ROUND(
        SUM(CASE WHEN aps.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
        NULLIF(SUM(CASE WHEN aps.status IN ('present','absent') THEN 1 ELSE 0 END), 0),
        1
      ) AS avg_pct
      ${fromSql}
      `,
      params,
    ),
    queryAcademic<(RowDataPacket & { band: string; total: number })[]>(
      `
      SELECT band, COUNT(*) AS total FROM (
        SELECT
          CASE
            WHEN pct >= 90 THEN '90%+'
            WHEN pct >= 75 THEN '75–89%'
            ELSE 'Below 75%'
          END AS band
        FROM (
          SELECT
            aps.student_db_id,
            SUM(CASE WHEN aps.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
            NULLIF(SUM(CASE WHEN aps.status IN ('present','absent') THEN 1 ELSE 0 END), 0) AS pct
          ${fromSql}
          GROUP BY aps.student_db_id
        ) t
      ) bands
      GROUP BY band
      `,
      params,
    ),
    queryAcademic<
      (RowDataPacket & { section_name: string | null; avg_pct: number | null })[]
    >(
      `
      SELECT
        cs.section_name,
        ROUND(
          SUM(CASE WHEN aps.status = 'present' THEN 1 ELSE 0 END) * 100.0 /
          NULLIF(SUM(CASE WHEN aps.status IN ('present','absent') THEN 1 ELSE 0 END), 0),
          1
        ) AS avg_pct
      ${fromSql}
      GROUP BY cs.section_name
      ORDER BY avg_pct ASC
      LIMIT 12
      `,
      params,
    ),
    queryAcademic<(RowDataPacket & { pending: number; posted: number; scheduled: number })[]>(
      `
      SELECT
        SUM(CASE WHEN cs.session_date = CURDATE() AND cs.status IN ('scheduled','posted') THEN 1 ELSE 0 END) AS scheduled,
        SUM(CASE WHEN cs.session_date = CURDATE() AND ap.id IS NOT NULL THEN 1 ELSE 0 END) AS posted,
        SUM(CASE WHEN cs.session_date = CURDATE() AND ap.id IS NULL AND cs.status = 'scheduled' THEN 1 ELSE 0 END) AS pending
      FROM ap_class_sessions cs
      INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
      LEFT JOIN ap_attendance_posts ap ON ap.class_session_id = cs.id
      WHERE ${todayWhere.join(" AND ")}
      `,
      todayParams,
    ),
  ]);

  const below = bandRows.find((row) => row.band === "Below 75%")?.total ?? 0;

  return {
    overallAttendance: Number(overallRows[0]?.avg_pct ?? 0),
    studentsBelowThreshold: Number(below),
    bands: bandRows.map((row) => ({
      label: row.band,
      total: Number(row.total),
    })),
    sections: sectionRows.map((row) => ({
      section: row.section_name ?? "—",
      attendance: Number(row.avg_pct ?? 0),
    })),
    today: {
      scheduled: Number(pendingRows[0]?.scheduled ?? 0),
      posted: Number(pendingRows[0]?.posted ?? 0),
      pending: Number(pendingRows[0]?.pending ?? 0),
    },
    source: "academic_portal.ap_attendance_posts (class sessions, last 90 days)",
  };
}

/** Kept so command center can reuse session stats without Student DB period_slots. */
export async function getTodaySessionCounts(filters: {
  collegeId?: number;
  collegeIds?: number[];
  branchId?: number;
  branchIds?: number[];
} = {}) {
  const analytics = await getAttendanceAnalytics(filters);
  return analytics.today;
}

export { todayIso };
