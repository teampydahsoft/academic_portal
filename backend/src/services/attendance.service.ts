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
const POSTING_MARKS: AttendanceMark[] = ["present", "absent"];

function normalizePostingMark(status: AttendanceMark | string | null | undefined): AttendanceMark {
  if (!status) return "present";
  return status === "absent" ? "absent" : "present";
}

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
  pin_no: string | null;
  student_name: string | null;
  course: string | null;
  branch: string | null;
  current_year: number | null;
  current_semester: number | null;
  has_photo?: number;
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
  startDate?: string;
  endDate?: string;
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
  facultyStaffLinkId?: number;
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
  const today = todayIso();
  if (!filters.startDate && date > today) {
    return {
      date,
      scheduled: 0,
      posted: 0,
      data: [],
      message: `Attendance posting is not allowed for future dates (${date}). Select today or a past date within the current semester.`,
    };
  }

  let generated = null as Awaited<ReturnType<typeof ensureSessionsForDate>> | null;

  if (filters.generate !== false && !filters.startDate) {
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

  const where = [
    "cs.status <> 'cancelled'",
    "(p.status = 'published' OR ap.id IS NOT NULL)",
  ];
  const params: unknown[] = [];

  if (filters.startDate && filters.endDate) {
    where.push("cs.session_date BETWEEN ? AND ?");
    params.push(filters.startDate, filters.endDate);
  } else {
    where.push("cs.session_date = ?");
    params.push(date);
  }

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
  if (filters.facultyStaffLinkId != null) {
    where.push("cs.faculty_staff_link_id = ?");
    params.push(filters.facultyStaffLinkId);
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

  const collegeIds = Array.from(new Set(rows.map((r) => r.college_id).filter(Boolean)));
  const courseIds = Array.from(new Set(rows.map((r) => r.course_id).filter(Boolean)));
  const branchIds = Array.from(new Set(rows.map((r) => r.branch_id).filter(Boolean)));

  const [colleges, courses, branches] = await Promise.all([
    collegeIds.length
      ? queryStudent<{ id: number; name: string }[]>(
          `SELECT id, name FROM colleges WHERE id IN (${collegeIds.map(() => "?").join(",")})`,
          collegeIds,
        )
      : [],
    courseIds.length
      ? queryStudent<{ id: number; name: string }[]>(
          `SELECT id, name FROM courses WHERE id IN (${courseIds.map(() => "?").join(",")})`,
          courseIds,
        )
      : [],
    branchIds.length
      ? queryStudent<{ id: number; name: string }[]>(
          `SELECT id, name FROM course_branches WHERE id IN (${branchIds.map(() => "?").join(",")})`,
          branchIds,
        )
      : [],
  ]);

  const collegeMap = new Map(colleges.map((c) => [c.id, c.name]));
  const courseMap = new Map(courses.map((c) => [c.id, c.name]));
  const branchMap = new Map(branches.map((b) => [b.id, b.name]));

  const holidays = await listCustomHolidays({ startDate: date, endDate: date });
  const sessions = rows
    .map((row) => {
      const holiday = holidays.some((item) =>
        holidayAppliesToScope(item, holidayScopeFromRow(row)),
      );
      const card = mapSessionCard(row, holiday);
      return {
        ...card,
        collegeName: collegeMap.get(Number(row.college_id)) ?? `College #${row.college_id}`,
        courseName: courseMap.get(Number(row.course_id)) ?? `Course #${row.course_id}`,
        branchName: branchMap.get(Number(row.branch_id)) ?? `Branch #${row.branch_id}`,
      };
    })
    .filter((session) => !session.holiday);

  const byCollegeMap = new Map<
    number,
    {
      collegeId: number;
      collegeName: string;
      totalSessions: number;
      pending: number;
      posted: number;
      branches: Map<
        number,
        {
          branchId: number;
          branchName: string;
          totalSessions: number;
          pending: number;
          posted: number;
        }
      >;
    }
  >();

  for (const s of sessions) {
    const cid = Number(s.collegeId);
    let col = byCollegeMap.get(cid);
    if (!col) {
      col = {
        collegeId: cid,
        collegeName: s.collegeName,
        totalSessions: 0,
        pending: 0,
        posted: 0,
        branches: new Map(),
      };
      byCollegeMap.set(cid, col);
    }
    col.totalSessions += 1;
    if (s.posted) col.posted += 1;
    else col.pending += 1;

    const bid = Number(s.branchId);
    let br = col.branches.get(bid);
    if (!br) {
      br = {
        branchId: bid,
        branchName: s.branchName,
        totalSessions: 0,
        pending: 0,
        posted: 0,
      };
      col.branches.set(bid, br);
    }
    br.totalSessions += 1;
    if (s.posted) br.posted += 1;
    else br.pending += 1;
  }

  const byCollege = Array.from(byCollegeMap.values()).map((col) => ({
    collegeId: col.collegeId,
    collegeName: col.collegeName,
    totalSessions: col.totalSessions,
    pending: col.pending,
    posted: col.posted,
    completionPct: col.totalSessions
      ? Math.round((col.posted / col.totalSessions) * 100)
      : 0,
    byBranch: Array.from(col.branches.values()).map((br) => ({
      branchId: br.branchId,
      branchName: br.branchName,
      totalSessions: br.totalSessions,
      pending: br.pending,
      posted: br.posted,
      completionPct: br.totalSessions
        ? Math.round((br.posted / br.totalSessions) * 100)
        : 0,
    })),
  }));

  const abstract = {
    totalColleges: byCollege.length,
    totalCourses: courseIds.length,
    totalBranches: branchIds.length,
    overallCompletionPct: sessions.length
      ? Math.round((sessions.filter((s) => s.posted).length / sessions.length) * 100)
      : 0,
    byCollege,
  };

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
    abstract,
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
    SELECT s.id, s.admission_number, s.pin_no, s.student_name, s.course, s.branch, s.current_year, s.current_semester,
           CASE WHEN s.student_photo IS NOT NULL AND TRIM(s.student_photo) <> '' THEN 1 ELSE 0 END AS has_photo
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id, s.admission_number, s.pin_no, s.student_name, s.course, s.branch, s.current_year, s.current_semester
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
        pinNo: student.pin_no ?? null,
        course: student.course ?? null,
        branch: student.branch ?? null,
        year: student.current_year ?? null,
        semester: student.current_semester ?? null,
        hasPhoto: Boolean(student.has_photo),
        status: normalizePostingMark(existing?.status),
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
    /** When set, only the assigned faculty may post this session. */
    requiredFacultyStaffLinkId?: number | null;
  },
) {
  const row = await loadSessionContext(sessionId);
  if (!row) {
    throw Object.assign(new Error("Class session not found"), { status: 404 });
  }
  if (
    input.requiredFacultyStaffLinkId != null &&
    Number(row.faculty_staff_link_id) !== Number(input.requiredFacultyStaffLinkId)
  ) {
    throw Object.assign(
      new Error("You can only post attendance for your own assigned classes"),
      { status: 403 },
    );
  }
  if (row.status === "cancelled") {
    throw Object.assign(new Error("This class session is cancelled"), { status: 400 });
  }

  const date = asDate(row.session_date)!;
  const today = todayIso();
  if (date > today) {
    throw Object.assign(
      new Error(`Cannot post attendance for future dates (${date}).`),
      { status: 400 },
    );
  }
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
    if (!POSTING_MARKS.includes(item.status)) {
      throw Object.assign(
        new Error(`Invalid status: ${item.status}. Only present or absent are allowed.`),
        { status: 400 },
      );
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

export async function loadScopeStudents(filters: {
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  batch?: string;
  year?: number;
  semester?: number;
  section?: string;
}) {
  const where = [
    `(s.student_status IS NULL OR (
      LOWER(TRIM(s.student_status)) NOT IN ('relieved', 'discontinued', 'inactive', 'cancelled', 'admission cancelled')
      AND LOWER(s.student_status) NOT LIKE '%cancel%'
    ))`,
  ];
  const params: unknown[] = [];

  if (filters.branchId) {
    where.push("s.branch_id = ?");
    params.push(filters.branchId);
  } else if (filters.branchIds?.length) {
    where.push(`s.branch_id IN (${filters.branchIds.map(() => "?").join(",")})`);
    params.push(...filters.branchIds);
  }
  if (filters.collegeId) {
    where.push("s.college_id = ?");
    params.push(filters.collegeId);
  } else if (filters.collegeIds?.length) {
    where.push(`s.college_id IN (${filters.collegeIds.map(() => "?").join(",")})`);
    params.push(...filters.collegeIds);
  }
  if (filters.courseId) {
    where.push("s.course_id = ?");
    params.push(filters.courseId);
  }
  if (filters.batch) {
    where.push("TRIM(s.batch) = ?");
    params.push(filters.batch);
  } else {
    if (filters.year != null) {
      where.push("s.current_year = ?");
      params.push(filters.year);
    }
    if (filters.semester != null) {
      where.push("s.current_semester = ?");
      params.push(filters.semester);
    }
  }
  if (filters.section) {
    where.push(`
      TRIM(COALESCE(
        ss.section_name COLLATE utf8mb4_unicode_ci,
        s.section COLLATE utf8mb4_unicode_ci,
        '' COLLATE utf8mb4_unicode_ci
      )) = TRIM(?) COLLATE utf8mb4_unicode_ci
    `);
    params.push(filters.section);
  }

  return queryStudent<StudentRow[]>(
    `
    SELECT s.id, s.admission_number, s.pin_no, s.student_name, s.course, s.branch, s.current_year, s.current_semester,
           CASE WHEN s.student_photo IS NOT NULL AND TRIM(s.student_photo) <> '' THEN 1 ELSE 0 END AS has_photo
    FROM students s
    LEFT JOIN student_sections ss ON ss.student_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id, s.admission_number, s.pin_no, s.student_name, s.course, s.branch, s.current_year, s.current_semester
    ORDER BY COALESCE(NULLIF(TRIM(s.pin_no), ''), s.admission_number), s.student_name
    LIMIT 1000
    `,
    params,
  );
}

export type DailyAttendanceAnalyticsResult = {
  date: string;
  section: string | null;
  availableSections: string[];
  slots: Array<{
    sessionId: number;
    slotLabel: string;
    startTime: string;
    endTime: string;
    time: string;
    subjectId: number | null;
    subjectCode: string | null;
    subjectName: string | null;
    facultyName: string | null;
    roomLabel: string | null;
    status: string;
    posted: boolean;
    postId: number | null;
    presentCount: number;
    absentCount: number;
    odCount: number;
    leaveCount: number;
  }>;
  students: Array<{
    id: string;
    studentDbId: number;
    name: string;
    pinNo: string | null;
    admissionNo: string;
    course: string | null;
    branch: string | null;
    year: number | null;
    semester: number | null;
    hasPhoto: boolean;
    slots: Record<
      number,
      {
        sessionId: number;
        status: AttendanceMark | "pending" | "unposted";
        remarks: string | null;
      }
    >;
    totalPresent: number;
    totalAbsent: number;
    totalOd: number;
    totalLeave: number;
    totalConducted: number;
    totalSlots: number;
    percentage: number | null;
  }>;
  summary: {
    totalStudents: number;
    totalSlots: number;
    postedSlots: number;
    pendingSlots: number;
    totalPresentMarks: number;
    totalAbsentMarks: number;
    avgAttendancePct: number;
  };
};

export async function getDailyAttendanceAnalytics(filters: {
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
}): Promise<DailyAttendanceAnalyticsResult> {
  const date = filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date) ? filters.date : todayIso();

  // Pre-generate sessions for today or past dates within the current semester if missing
  if (date <= todayIso()) {
    await ensureSessionsForDate(date, {
      collegeId: filters.collegeId,
      courseId: filters.courseId,
      branchId: filters.branchId,
      batch: filters.batch,
      year: filters.year,
      semester: filters.semester,
      section: filters.section,
      academicYear: filters.academicYear,
    }).catch(() => null);
  }

  const where = [
    "cs.session_date = ?",
    "cs.status <> 'cancelled'",
    "(p.status = 'published' OR ap.id IS NOT NULL)",
  ];
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
  if (filters.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(filters.academicYear);
  }

  const allDaySessions = await queryAcademic<SessionListRow[]>(
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
      COALESCE(ts.label, CONCAT('P', cs.period_slot_id)) AS slot_label,
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

  const availableSections = Array.from(
    new Set(allDaySessions.map((r) => r.section_name).filter(Boolean)),
  ) as string[];

  const activeSection =
    filters.section && filters.section !== "all"
      ? filters.section
      : availableSections.length > 0
        ? availableSections[0]
        : null;

  const sectionSessions = activeSection
    ? allDaySessions.filter(
        (r) =>
          (r.section_name || "").trim().toLowerCase() ===
          activeSection.trim().toLowerCase(),
      )
    : allDaySessions;

  // Load roster students
  const students = await loadScopeStudents({
    collegeId: filters.collegeId,
    collegeIds: filters.collegeIds,
    courseId: filters.courseId,
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    batch: filters.batch,
    year: filters.year,
    semester: filters.semester,
    section: activeSection || undefined,
  });

  const slots = sectionSessions.map((row) => ({
    sessionId: Number(row.id),
    slotLabel: row.slot_label || `Period ${row.period_slot_id || ""}`.trim(),
    startTime: row.start_time ? String(row.start_time).slice(0, 5) : "",
    endTime: row.end_time ? String(row.end_time).slice(0, 5) : "",
    time: [
      row.start_time ? String(row.start_time).slice(0, 5) : "",
      row.end_time ? String(row.end_time).slice(0, 5) : "",
    ]
      .filter(Boolean)
      .join(" – "),
    subjectId: row.subject_id ? Number(row.subject_id) : null,
    subjectCode: row.subject_code || null,
    subjectName: row.subject_name || null,
    facultyName: row.faculty_name || null,
    roomLabel: row.room_label || null,
    status: row.status,
    posted: Boolean(row.post_id),
    postId: row.post_id ? Number(row.post_id) : null,
    presentCount: Number(row.present_count ?? 0),
    absentCount: Number(row.absent_count ?? 0),
    odCount: Number(row.od_count ?? 0),
    leaveCount: Number(row.leave_count ?? 0),
  }));

  const postIds = slots.map((s) => s.postId).filter(Boolean) as number[];
  type MarkRow = RowDataPacket & {
    attendance_post_id: number;
    student_db_id: number;
    status: AttendanceMark;
    remarks: string | null;
  };

  const marks =
    postIds.length > 0
      ? await queryAcademic<MarkRow[]>(
          `
          SELECT attendance_post_id, student_db_id, status, remarks
          FROM ap_attendance_post_students
          WHERE attendance_post_id IN (${postIds.map(() => "?").join(",")})
          `,
          postIds,
        )
      : [];

  const markMap = new Map<string, { status: AttendanceMark; remarks: string | null }>();
  for (const m of marks) {
    markMap.set(`${m.attendance_post_id}_${m.student_db_id}`, {
      status: m.status,
      remarks: m.remarks,
    });
  }

  const studentsList = students.map((student) => {
    let studentPresent = 0;
    let studentAbsent = 0;
    let studentOd = 0;
    let studentLeave = 0;
    let studentConducted = 0;

    const studentSlots: Record<
      number,
      {
        sessionId: number;
        status: AttendanceMark | "pending" | "unposted";
        remarks: string | null;
      }
    > = {};

    for (const slot of slots) {
      if (!slot.posted || !slot.postId) {
        studentSlots[slot.sessionId] = {
          sessionId: slot.sessionId,
          status: "pending",
          remarks: null,
        };
      } else {
        studentConducted++;
        const mark = markMap.get(`${slot.postId}_${student.id}`);
        const markStatus = mark ? mark.status : "absent";
        if (markStatus === "present") {
          studentPresent++;
        } else if (markStatus === "od") {
          studentOd++;
          studentPresent++;
        } else if (markStatus === "leave") {
          studentLeave++;
        } else {
          studentAbsent++;
        }

        studentSlots[slot.sessionId] = {
          sessionId: slot.sessionId,
          status: markStatus,
          remarks: mark?.remarks ?? null,
        };
      }
    }

    const percentage =
      studentConducted > 0
        ? Math.round((studentPresent / studentConducted) * 1000) / 10
        : null;

    return {
      id: String(student.id),
      studentDbId: Number(student.id),
      name: student.student_name || "Unknown",
      pinNo: student.pin_no || null,
      admissionNo: student.admission_number,
      course: student.course || null,
      branch: student.branch || null,
      year: filters.year ?? (student.current_year ? Number(student.current_year) : null),
      semester: filters.semester ?? (student.current_semester ? Number(student.current_semester) : null),
      hasPhoto: Boolean(student.has_photo),
      slots: studentSlots,
      totalPresent: studentPresent,
      totalAbsent: studentAbsent,
      totalOd: studentOd,
      totalLeave: studentLeave,
      totalConducted: studentConducted,
      totalSlots: slots.length,
      percentage,
    };
  });

  const totalStudents = studentsList.length;
  const postedSlotsCount = slots.filter((s) => s.posted).length;
  const totalConductedSlotsSum = studentsList.reduce((s, st) => s + st.totalConducted, 0);
  const totalPresentSum = studentsList.reduce((s, st) => s + st.totalPresent, 0);
  const totalAbsentSum = studentsList.reduce((s, st) => s + st.totalAbsent, 0);

  const avgAttendancePct =
    totalConductedSlotsSum > 0
      ? Math.round((totalPresentSum / totalConductedSlotsSum) * 1000) / 10
      : 0;

  return {
    date,
    section: activeSection,
    availableSections,
    slots,
    students: studentsList,
    summary: {
      totalStudents,
      totalSlots: slots.length,
      postedSlots: postedSlotsCount,
      pendingSlots: slots.length - postedSlotsCount,
      totalPresentMarks: totalPresentSum,
      totalAbsentMarks: totalAbsentSum,
      avgAttendancePct,
    },
  };
}

export type WeeklyAttendanceAnalyticsResult = {
  startDate: string;
  endDate: string;
  weekLabel: string;
  section: string | null;
  availableSections: string[];
  days: Array<{
    date: string;
    dayOfWeek: string;
    dayLabel: string;
    totalSlots: number;
    postedSlots: number;
    slots: Array<{
      sessionId: number;
      slotLabel: string;
      startTime: string;
      endTime: string;
      time: string;
      subjectId: number | null;
      subjectCode: string | null;
      subjectName: string | null;
      facultyName: string | null;
      roomLabel: string | null;
      status: string;
      posted: boolean;
      postId: number | null;
      presentCount: number;
      absentCount: number;
      odCount: number;
      leaveCount: number;
    }>;
  }>;
  students: Array<{
    id: string;
    studentDbId: number;
    name: string;
    pinNo: string | null;
    admissionNo: string;
    course: string | null;
    branch: string | null;
    year: number | null;
    semester: number | null;
    hasPhoto: boolean;
    days: Record<
      string,
      {
        date: string;
        dayOfWeek: string;
        totalSlots: number;
        presentCount: number;
        absentCount: number;
        odCount: number;
        leaveCount: number;
        percentage: number | null;
        slots: Record<
          number,
          {
            sessionId: number;
            slotLabel: string;
            subjectCode: string | null;
            status: AttendanceMark | "pending" | "unposted";
            remarks: string | null;
          }
        >;
      }
    >;
    totalPresent: number;
    totalAbsent: number;
    totalOd: number;
    totalLeave: number;
    totalConducted: number;
    totalSlots: number;
    percentage: number | null;
  }>;
  summary: {
    totalStudents: number;
    totalSlotsInWeek: number;
    postedSlotsInWeek: number;
    totalPresentMarks: number;
    totalAbsentMarks: number;
    avgAttendancePct: number;
  };
};

export async function getWeeklyAttendanceAnalytics(filters: {
  date?: string;
  startDate?: string;
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
}): Promise<WeeklyAttendanceAnalyticsResult> {
  const refDate =
    filters.startDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate)
      ? filters.startDate
      : filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)
        ? filters.date
        : todayIso();

  const d = new Date(refDate + "T00:00:00");
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diffToMonday);

  const weekDates: string[] = [];
  for (let i = 0; i < 6; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const dayNum = String(cur.getDate()).padStart(2, "0");
    weekDates.push(`${y}-${m}-${dayNum}`);
  }

  const startDate = weekDates[0];
  const endDate = weekDates[weekDates.length - 1];

  const monthShorts = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const startD = new Date(startDate + "T00:00:00");
  const endD = new Date(endDate + "T00:00:00");
  const weekLabel = `${monthShorts[startD.getMonth()]} ${String(startD.getDate()).padStart(2, "0")} – ${monthShorts[endD.getMonth()]} ${String(endD.getDate()).padStart(2, "0")}, ${endD.getFullYear()}`;

  // Pre-generate sessions for the week's dates from the published timetable plan
  for (const date of weekDates) {
    await ensureSessionsForDate(date, {
      collegeId: filters.collegeId,
      courseId: filters.courseId,
      branchId: filters.branchId,
      batch: filters.batch,
      year: filters.year,
      semester: filters.semester,
      section: filters.section,
      academicYear: filters.academicYear,
    }).catch(() => null);
  }

  const where = [
    "cs.session_date >= ?",
    "cs.session_date <= ?",
    "cs.status <> 'cancelled'",
    "(p.status = 'published' OR ap.id IS NOT NULL)",
  ];
  const params: unknown[] = [startDate, endDate];

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
  if (filters.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(filters.academicYear);
  }

  const allWeekSessions = await queryAcademic<SessionListRow[]>(
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
      COALESCE(ts.label, CONCAT('P', cs.period_slot_id)) AS slot_label,
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
    ORDER BY cs.session_date, cs.start_time, cs.id
    `,
    params,
  );

  const availableSections = Array.from(
    new Set(allWeekSessions.map((r) => r.section_name).filter(Boolean)),
  ) as string[];

  const activeSection =
    filters.section && filters.section !== "all"
      ? filters.section
      : availableSections.length > 0
        ? availableSections[0]
        : null;

  const sectionSessions = activeSection
    ? allWeekSessions.filter(
        (r) =>
          (r.section_name || "").trim().toLowerCase() ===
          activeSection.trim().toLowerCase(),
      )
    : allWeekSessions;

  // Load roster students (with cohort semester preservation)
  const students = await loadScopeStudents({
    collegeId: filters.collegeId,
    collegeIds: filters.collegeIds,
    courseId: filters.courseId,
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    batch: filters.batch,
    year: filters.year,
    semester: filters.semester,
    section: activeSection || undefined,
  });

  // Group sessions by date
  const sessionsByDate = new Map<string, SessionListRow[]>();
  for (const date of weekDates) sessionsByDate.set(date, []);
  for (const s of sectionSessions) {
    const dStr = asDate(s.session_date);
    if (dStr && sessionsByDate.has(dStr)) {
      sessionsByDate.get(dStr)!.push(s);
    }
  }

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = weekDates.map((date, idx) => {
    const daySessions = sessionsByDate.get(date) || [];
    const dayOfWeek = dayNames[idx];
    const postedSlots = daySessions.filter((s) => s.post_id != null).length;

    return {
      date,
      dayOfWeek,
      dayLabel: `${dayOfWeek} (${date.slice(5)})`,
      totalSlots: daySessions.length,
      postedSlots,
      slots: daySessions.map((row) => ({
        sessionId: Number(row.id),
        slotLabel: row.slot_label || `P${row.period_slot_id || ""}`.trim(),
        startTime: row.start_time ? String(row.start_time).slice(0, 5) : "",
        endTime: row.end_time ? String(row.end_time).slice(0, 5) : "",
        time: [
          row.start_time ? String(row.start_time).slice(0, 5) : "",
          row.end_time ? String(row.end_time).slice(0, 5) : "",
        ]
          .filter(Boolean)
          .join(" – "),
        subjectId: row.subject_id ? Number(row.subject_id) : null,
        subjectCode: row.subject_code || null,
        subjectName: row.subject_name || null,
        facultyName: row.faculty_name || null,
        roomLabel: row.room_label || null,
        status: row.status,
        posted: Boolean(row.post_id),
        postId: row.post_id ? Number(row.post_id) : null,
        presentCount: Number(row.present_count ?? 0),
        absentCount: Number(row.absent_count ?? 0),
        odCount: Number(row.od_count ?? 0),
        leaveCount: Number(row.leave_count ?? 0),
      })),
    };
  });

  const postIds = sectionSessions
    .map((s) => s.post_id)
    .filter(Boolean) as number[];

  type MarkRow = RowDataPacket & {
    attendance_post_id: number;
    student_db_id: number;
    status: AttendanceMark;
    remarks: string | null;
  };

  const marks =
    postIds.length > 0
      ? await queryAcademic<MarkRow[]>(
          `
          SELECT attendance_post_id, student_db_id, status, remarks
          FROM ap_attendance_post_students
          WHERE attendance_post_id IN (${postIds.map(() => "?").join(",")})
          `,
          postIds,
        )
      : [];

  const markMap = new Map<string, { status: AttendanceMark; remarks: string | null }>();
  for (const m of marks) {
    markMap.set(`${m.attendance_post_id}_${m.student_db_id}`, {
      status: m.status,
      remarks: m.remarks,
    });
  }

  const studentsList = students.map((student) => {
    let studentWeekPresent = 0;
    let studentWeekAbsent = 0;
    let studentWeekOd = 0;
    let studentWeekLeave = 0;
    let studentWeekConducted = 0;
    let studentWeekTotalSlots = 0;

    const studentDays: WeeklyAttendanceAnalyticsResult["students"][0]["days"] = {};

    for (const d of days) {
      let dayPresent = 0;
      let dayAbsent = 0;
      let dayOd = 0;
      let dayLeave = 0;
      let dayConducted = 0;

      const daySlotsRecord: Record<
        number,
        {
          sessionId: number;
          slotLabel: string;
          subjectCode: string | null;
          status: AttendanceMark | "pending" | "unposted";
          remarks: string | null;
        }
      > = {};

      for (const slot of d.slots) {
        studentWeekTotalSlots++;
        if (!slot.posted || !slot.postId) {
          daySlotsRecord[slot.sessionId] = {
            sessionId: slot.sessionId,
            slotLabel: slot.slotLabel,
            subjectCode: slot.subjectCode,
            status: "pending",
            remarks: null,
          };
        } else {
          dayConducted++;
          studentWeekConducted++;
          const mark = markMap.get(`${slot.postId}_${student.id}`);
          const markStatus = mark ? mark.status : "absent";
          if (markStatus === "present") {
            dayPresent++;
            studentWeekPresent++;
          } else if (markStatus === "od") {
            dayOd++;
            dayPresent++;
            studentWeekOd++;
            studentWeekPresent++;
          } else if (markStatus === "leave") {
            dayLeave++;
            studentWeekLeave++;
          } else {
            dayAbsent++;
            studentWeekAbsent++;
          }

          daySlotsRecord[slot.sessionId] = {
            sessionId: slot.sessionId,
            slotLabel: slot.slotLabel,
            subjectCode: slot.subjectCode,
            status: markStatus,
            remarks: mark?.remarks ?? null,
          };
        }
      }

      studentDays[d.date] = {
        date: d.date,
        dayOfWeek: d.dayOfWeek,
        totalSlots: d.slots.length,
        presentCount: dayPresent,
        absentCount: dayAbsent,
        odCount: dayOd,
        leaveCount: dayLeave,
        percentage: dayConducted > 0 ? Math.round((dayPresent / dayConducted) * 1000) / 10 : null,
        slots: daySlotsRecord,
      };
    }

    const percentage =
      studentWeekConducted > 0
        ? Math.round((studentWeekPresent / studentWeekConducted) * 1000) / 10
        : null;

    return {
      id: String(student.id),
      studentDbId: Number(student.id),
      name: student.student_name || "Unknown",
      pinNo: student.pin_no || null,
      admissionNo: student.admission_number,
      course: student.course || null,
      branch: student.branch || null,
      year: filters.year ?? (student.current_year ? Number(student.current_year) : null),
      semester: filters.semester ?? (student.current_semester ? Number(student.current_semester) : null),
      hasPhoto: Boolean(student.has_photo),
      days: studentDays,
      totalPresent: studentWeekPresent,
      totalAbsent: studentWeekAbsent,
      totalOd: studentWeekOd,
      totalLeave: studentWeekLeave,
      totalConducted: studentWeekConducted,
      totalSlots: studentWeekTotalSlots,
      percentage,
    };
  });

  const totalSlotsInWeek = days.reduce((acc, d) => acc + d.totalSlots, 0);
  const postedSlotsInWeek = days.reduce((acc, d) => acc + d.postedSlots, 0);
  const totalPresentMarks = studentsList.reduce((acc, s) => acc + s.totalPresent, 0);
  const totalAbsentMarks = studentsList.reduce((acc, s) => acc + s.totalAbsent, 0);
  const totalConductedMarks = totalPresentMarks + totalAbsentMarks;
  const avgAttendancePct =
    totalConductedMarks > 0 ? Math.round((totalPresentMarks / totalConductedMarks) * 1000) / 10 : 0;

  return {
    startDate,
    endDate,
    weekLabel,
    section: activeSection,
    availableSections,
    days,
    students: studentsList,
    summary: {
      totalStudents: studentsList.length,
      totalSlotsInWeek,
      postedSlotsInWeek,
      totalPresentMarks,
      totalAbsentMarks,
      avgAttendancePct,
    },
  };
}

export type MonthlyAttendanceAnalyticsResult = {
  month: number;
  year: number;
  monthName: string;
  students: Array<{
    id: string;
    studentDbId: number;
    name: string;
    pinNo: string | null;
    admissionNo: string;
    course: string | null;
    branch: string | null;
    year: number | null;
    semester: number | null;
    hasPhoto: boolean;
    totalSlots: number;
    presentCount: number;
    absentCount: number;
    odCount: number;
    leaveCount: number;
    percentage: number;
    status: "good" | "warning" | "critical";
  }>;
  daySummaries: Array<{
    date: string;
    dayOfWeek: string;
    totalSessions: number;
    postedSessions: number;
    presentCount: number;
    absentCount: number;
    avgPct: number;
  }>;
  summary: {
    totalStudents: number;
    totalSessionsConducted: number;
    avgAttendancePct: number;
    safeCount: number;
    warningCount: number;
    criticalCount: number;
  };
};

export async function getMonthlyAttendanceAnalytics(filters: {
  month?: number;
  year?: number;
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  batch?: string;
  yearOfStudy?: number;
  semester?: number;
  section?: string;
  academicYear?: string;
}): Promise<MonthlyAttendanceAnalyticsResult> {
  const now = new Date();
  const year = filters.year && Number.isFinite(filters.year) ? filters.year : now.getFullYear();
  const month =
    filters.month && Number.isFinite(filters.month) && filters.month >= 1 && filters.month <= 12
      ? filters.month
      : now.getMonth() + 1;

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = `${monthNames[month - 1]} ${year}`;

  const students = await loadScopeStudents({
    collegeId: filters.collegeId,
    collegeIds: filters.collegeIds,
    courseId: filters.courseId,
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    batch: filters.batch,
    year: filters.yearOfStudy,
    semester: filters.semester,
    section: filters.section,
  });

  const where = [
    "cs.session_date >= ?",
    "cs.session_date <= ?",
    "cs.status <> 'cancelled'",
  ];
  const params: unknown[] = [startDate, endDate];

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
  if (filters.yearOfStudy != null) {
    where.push("p.year_of_study = ?");
    params.push(filters.yearOfStudy);
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

  type StudentAggRow = RowDataPacket & {
    student_db_id: number;
    total_conducted: number;
    present_count: number;
    absent_count: number;
    od_count: number;
    leave_count: number;
  };

  type DaySummaryRow = RowDataPacket & {
    session_date: string;
    day_of_week: string;
    total_sessions: number;
    posted_sessions: number;
    present_count: number;
    absent_count: number;
  };

  const [studentRows, dayRows] = await Promise.all([
    queryAcademic<StudentAggRow[]>(
      `
      SELECT
        aps.student_db_id,
        COUNT(DISTINCT cs.id) AS total_conducted,
        SUM(CASE WHEN aps.status IN ('present', 'od') THEN 1 ELSE 0 END) AS present_count,
        SUM(CASE WHEN aps.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
        SUM(CASE WHEN aps.status = 'od' THEN 1 ELSE 0 END) AS od_count,
        SUM(CASE WHEN aps.status = 'leave' THEN 1 ELSE 0 END) AS leave_count
      FROM ap_attendance_post_students aps
      INNER JOIN ap_attendance_posts ap ON ap.id = aps.attendance_post_id
      INNER JOIN ap_class_sessions cs ON cs.id = ap.class_session_id
      INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
      WHERE ${where.join(" AND ")}
      GROUP BY aps.student_db_id
      `,
      params,
    ),
    queryAcademic<DaySummaryRow[]>(
      `
      SELECT
        DATE_FORMAT(cs.session_date, '%Y-%m-%d') AS session_date,
        cs.day_of_week,
        COUNT(DISTINCT cs.id) AS total_sessions,
        SUM(CASE WHEN ap.id IS NOT NULL THEN 1 ELSE 0 END) AS posted_sessions,
        SUM(COALESCE(ap.present_count, 0)) AS present_count,
        SUM(COALESCE(ap.absent_count, 0)) AS absent_count
      FROM ap_class_sessions cs
      INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
      LEFT JOIN ap_attendance_posts ap ON ap.class_session_id = cs.id
      WHERE ${where.join(" AND ")}
      GROUP BY cs.session_date, cs.day_of_week
      ORDER BY cs.session_date
      `,
      params,
    ),
  ]);

  const aggMap = new Map<number, StudentAggRow>();
  for (const row of studentRows) {
    aggMap.set(Number(row.student_db_id), row);
  }

  let safeCount = 0;
  let warningCount = 0;
  let criticalCount = 0;

  const studentsList = students.map((s) => {
    const agg = aggMap.get(Number(s.id));
    const totalSlots = Number(agg?.total_conducted ?? 0);
    const presentCount = Number(agg?.present_count ?? 0);
    const absentCount = Number(agg?.absent_count ?? 0);
    const odCount = Number(agg?.od_count ?? 0);
    const leaveCount = Number(agg?.leave_count ?? 0);

    const percentage =
      totalSlots > 0 ? Math.round((presentCount / totalSlots) * 1000) / 10 : 0;

    let status: "good" | "warning" | "critical" = "good";
    if (percentage >= 75) {
      status = "good";
      safeCount++;
    } else if (percentage >= 65) {
      status = "warning";
      warningCount++;
    } else {
      status = "critical";
      criticalCount++;
    }

    return {
      id: String(s.id),
      studentDbId: Number(s.id),
      name: s.student_name || "Unknown",
      pinNo: s.pin_no || null,
      admissionNo: s.admission_number,
      course: s.course || null,
      branch: s.branch || null,
      year: filters.yearOfStudy ?? (s.current_year ? Number(s.current_year) : null),
      semester: filters.semester ?? (s.current_semester ? Number(s.current_semester) : null),
      hasPhoto: Boolean(s.has_photo),
      totalSlots,
      presentCount,
      absentCount,
      odCount,
      leaveCount,
      percentage,
      status,
    };
  });

  const totalConductedSessions = dayRows.reduce(
    (acc, d) => acc + Number(d.posted_sessions || 0),
    0,
  );
  const totalPresentMarks = dayRows.reduce((acc, d) => acc + Number(d.present_count || 0), 0);
  const totalAbsentMarks = dayRows.reduce((acc, d) => acc + Number(d.absent_count || 0), 0);
  const totalMarks = totalPresentMarks + totalAbsentMarks;
  const avgAttendancePct =
    totalMarks > 0 ? Math.round((totalPresentMarks / totalMarks) * 1000) / 10 : 0;

  return {
    month,
    year,
    monthName,
    students: studentsList,
    daySummaries: dayRows.map((d) => {
      const tot = Number(d.present_count || 0) + Number(d.absent_count || 0);
      return {
        date: d.session_date,
        dayOfWeek: d.day_of_week,
        totalSessions: Number(d.total_sessions || 0),
        postedSessions: Number(d.posted_sessions || 0),
        presentCount: Number(d.present_count || 0),
        absentCount: Number(d.absent_count || 0),
        avgPct: tot > 0 ? Math.round((Number(d.present_count) / tot) * 1000) / 10 : 0,
      };
    }),
    summary: {
      totalStudents: studentsList.length,
      totalSessionsConducted: totalConductedSessions,
      avgAttendancePct,
      safeCount,
      warningCount,
      criticalCount,
    },
  };
}

export type SemesterAttendanceAnalyticsResult = {
  semester: number | null;
  academicYear: string | null;
  students: Array<{
    id: string;
    studentDbId: number;
    name: string;
    pinNo: string | null;
    admissionNo: string;
    course: string | null;
    branch: string | null;
    year: number | null;
    semester: number | null;
    hasPhoto: boolean;
    totalClasses: number;
    presentCount: number;
    absentCount: number;
    odCount: number;
    leaveCount: number;
    percentage: number;
    eligibility: "Eligible" | "Condonation Required" | "Detained";
    subjectBreakdown: Array<{
      subjectCode: string;
      subjectName: string;
      total: number;
      present: number;
      percentage: number;
    }>;
  }>;
  summary: {
    totalStudents: number;
    eligibleCount: number;
    condonationCount: number;
    detainedCount: number;
    avgAttendancePct: number;
    totalClassesConducted: number;
  };
  bands: Array<{ label: string; count: number; percentage: number }>;
};

export async function getSemesterAttendanceAnalytics(filters: {
  semester?: number;
  academicYear?: string;
  collegeId?: number;
  collegeIds?: number[];
  courseId?: number;
  branchId?: number;
  branchIds?: number[];
  batch?: string;
  yearOfStudy?: number;
  section?: string;
}): Promise<SemesterAttendanceAnalyticsResult> {
  const students = await loadScopeStudents({
    collegeId: filters.collegeId,
    collegeIds: filters.collegeIds,
    courseId: filters.courseId,
    branchId: filters.branchId,
    branchIds: filters.branchIds,
    batch: filters.batch,
    year: filters.yearOfStudy,
    semester: filters.semester,
    section: filters.section,
  });

  const where = ["cs.status <> 'cancelled'"];
  const params: unknown[] = [];

  if (filters.semester != null) {
    where.push("p.semester_number = ?");
    params.push(filters.semester);
  }
  if (filters.academicYear) {
    where.push("p.academic_year_label = ?");
    params.push(filters.academicYear);
  }
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
  if (filters.yearOfStudy != null) {
    where.push("p.year_of_study = ?");
    params.push(filters.yearOfStudy);
  }
  if (filters.section) {
    where.push("cs.section_name = ?");
    params.push(filters.section);
  }

  type OverallRow = RowDataPacket & {
    student_db_id: number;
    total_conducted: number;
    present_count: number;
    absent_count: number;
    od_count: number;
    leave_count: number;
  };

  type SubjectRow = RowDataPacket & {
    student_db_id: number;
    subject_code: string | null;
    subject_name: string | null;
    total_sessions: number;
    present_count: number;
  };

  const [studentRows, subjectRows] = await Promise.all([
    queryAcademic<OverallRow[]>(
      `
      SELECT
        aps.student_db_id,
        COUNT(DISTINCT cs.id) AS total_conducted,
        SUM(CASE WHEN aps.status IN ('present', 'od') THEN 1 ELSE 0 END) AS present_count,
        SUM(CASE WHEN aps.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
        SUM(CASE WHEN aps.status = 'od' THEN 1 ELSE 0 END) AS od_count,
        SUM(CASE WHEN aps.status = 'leave' THEN 1 ELSE 0 END) AS leave_count
      FROM ap_attendance_post_students aps
      INNER JOIN ap_attendance_posts ap ON ap.id = aps.attendance_post_id
      INNER JOIN ap_class_sessions cs ON cs.id = ap.class_session_id
      INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
      WHERE ${where.join(" AND ")}
      GROUP BY aps.student_db_id
      `,
      params,
    ),
    queryAcademic<SubjectRow[]>(
      `
      SELECT
        aps.student_db_id,
        COALESCE(NULLIF(TRIM(cs.subject_code), ''), 'GEN') AS subject_code,
        COALESCE(NULLIF(TRIM(cs.subject_name), ''), 'General') AS subject_name,
        COUNT(DISTINCT cs.id) AS total_sessions,
        SUM(CASE WHEN aps.status IN ('present', 'od') THEN 1 ELSE 0 END) AS present_count
      FROM ap_attendance_post_students aps
      INNER JOIN ap_attendance_posts ap ON ap.id = aps.attendance_post_id
      INNER JOIN ap_class_sessions cs ON cs.id = ap.class_session_id
      INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id
      WHERE ${where.join(" AND ")}
      GROUP BY aps.student_db_id, cs.subject_code, cs.subject_name
      ORDER BY cs.subject_name
      `,
      params,
    ),
  ]);

  const aggMap = new Map<number, OverallRow>();
  for (const r of studentRows) aggMap.set(Number(r.student_db_id), r);

  const subjectsByStudent = new Map<number, SubjectRow[]>();
  for (const s of subjectRows) {
    const list = subjectsByStudent.get(Number(s.student_db_id)) || [];
    list.push(s);
    subjectsByStudent.set(Number(s.student_db_id), list);
  }

  let eligibleCount = 0;
  let condonationCount = 0;
  let detainedCount = 0;
  let totalConductedClassesMax = 0;

  let band90 = 0;
  let band75 = 0;
  let band65 = 0;
  let bandBelow65 = 0;

  const studentsList = students.map((s) => {
    const agg = aggMap.get(Number(s.id));
    const totalClasses = Number(agg?.total_conducted ?? 0);
    const presentCount = Number(agg?.present_count ?? 0);
    const absentCount = Number(agg?.absent_count ?? 0);
    const odCount = Number(agg?.od_count ?? 0);
    const leaveCount = Number(agg?.leave_count ?? 0);

    if (totalClasses > totalConductedClassesMax) {
      totalConductedClassesMax = totalClasses;
    }

    const percentage =
      totalClasses > 0 ? Math.round((presentCount / totalClasses) * 1000) / 10 : 0;

    let eligibility: "Eligible" | "Condonation Required" | "Detained" = "Eligible";
    if (percentage >= 75) {
      eligibility = "Eligible";
      eligibleCount++;
    } else if (percentage >= 65) {
      eligibility = "Condonation Required";
      condonationCount++;
    } else {
      eligibility = "Detained";
      detainedCount++;
    }

    if (percentage >= 90) band90++;
    else if (percentage >= 75) band75++;
    else if (percentage >= 65) band65++;
    else bandBelow65++;

    const studentSubs = subjectsByStudent.get(Number(s.id)) || [];
    const subjectBreakdown = studentSubs.map((sub) => {
      const tot = Number(sub.total_sessions || 0);
      const pr = Number(sub.present_count || 0);
      return {
        subjectCode: sub.subject_code || "GEN",
        subjectName: sub.subject_name || "General",
        total: tot,
        present: pr,
        percentage: tot > 0 ? Math.round((pr / tot) * 1000) / 10 : 0,
      };
    });

    return {
      id: String(s.id),
      studentDbId: Number(s.id),
      name: s.student_name || "Unknown",
      pinNo: s.pin_no || null,
      admissionNo: s.admission_number,
      course: s.course || null,
      branch: s.branch || null,
      year: filters.yearOfStudy ?? (s.current_year ? Number(s.current_year) : null),
      semester: filters.semester ?? (s.current_semester ? Number(s.current_semester) : null),
      hasPhoto: Boolean(s.has_photo),
      totalClasses,
      presentCount,
      absentCount,
      odCount,
      leaveCount,
      percentage,
      eligibility,
      subjectBreakdown,
    };
  });

  const totalPr = studentsList.reduce((acc, s) => acc + s.presentCount, 0);
  const totalCl = studentsList.reduce((acc, s) => acc + s.totalClasses, 0);
  const avgAttendancePct =
    totalCl > 0 ? Math.round((totalPr / totalCl) * 1000) / 10 : 0;

  const totalStudents = studentsList.length;
  const bands = [
    {
      label: "90%+",
      count: band90,
      percentage: totalStudents > 0 ? Math.round((band90 / totalStudents) * 100) : 0,
    },
    {
      label: "75–89%",
      count: band75,
      percentage: totalStudents > 0 ? Math.round((band75 / totalStudents) * 100) : 0,
    },
    {
      label: "65–74%",
      count: band65,
      percentage: totalStudents > 0 ? Math.round((band65 / totalStudents) * 100) : 0,
    },
    {
      label: "Below 65%",
      count: bandBelow65,
      percentage: totalStudents > 0 ? Math.round((bandBelow65 / totalStudents) * 100) : 0,
    },
  ];

  return {
    semester: filters.semester ?? null,
    academicYear: filters.academicYear ?? null,
    students: studentsList,
    summary: {
      totalStudents,
      eligibleCount,
      condonationCount,
      detainedCount,
      avgAttendancePct,
      totalClassesConducted: totalConductedClassesMax,
    },
    bands,
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

