import "dotenv/config";
import {
  getDailyAttendanceAnalytics,
  getWeeklyAttendanceAnalytics,
  getMonthlyAttendanceAnalytics,
  getSemesterAttendanceAnalytics,
} from "../services/attendance.service.js";

async function main() {
  console.log("--- Testing Daily Attendance Analytics with Page Filters (Sem 1) ---");
  const daily = await getDailyAttendanceAnalytics({
    collegeId: 1,
    courseId: 1,
    branchId: 41,
    batch: "2023",
    year: 4,
    semester: 1,
  });
  console.log("Filtered Daily result (Sem 1):", {
    date: daily.date,
    section: daily.section,
    availableSections: daily.availableSections,
    slotsCount: daily.slots.length,
    studentsCount: daily.students.length,
    summary: daily.summary,
  });

  console.log("\n--- Testing Daily Attendance Analytics with Shifted Semester (Sem 2) ---");
  const dailySem2 = await getDailyAttendanceAnalytics({
    collegeId: 1,
    courseId: 1,
    branchId: 41,
    batch: "2023",
    year: 4,
    semester: 2,
  });
  console.log("Filtered Daily result (Shifted Sem 2):", {
    date: dailySem2.date,
    section: dailySem2.section,
    slotsCount: dailySem2.slots.length,
    studentsCount: dailySem2.students.length,
    sampleStudentSem: dailySem2.students[0]?.semester,
  });

  console.log("\n--- Testing Weekly Attendance Analytics ---");
  const weekly = await getWeeklyAttendanceAnalytics({
    collegeId: 1,
    courseId: 1,
    branchId: 41,
    batch: "2023",
    year: 4,
    semester: 1,
  });
  console.log("Weekly result:", {
    startDate: weekly.startDate,
    endDate: weekly.endDate,
    weekLabel: weekly.weekLabel,
    daysCount: weekly.days.length,
    daysList: weekly.days.map((d) => `${d.dayOfWeek}: ${d.totalSlots} slots`),
    studentsCount: weekly.students.length,
    summary: weekly.summary,
  });

  console.log("\n--- Testing Monthly Attendance Analytics ---");
  const monthly = await getMonthlyAttendanceAnalytics({ month: 9, year: 2026 });
  console.log("Monthly result:", {
    monthName: monthly.monthName,
    studentsCount: monthly.students.length,
    daysCount: monthly.daySummaries.length,
    summary: monthly.summary,
  });
  if (monthly.students.length > 0) {
    const s = monthly.students[0];
    console.log("Sample monthly student:", {
      name: s.name,
      pinNo: s.pinNo,
      totalSlots: s.totalSlots,
      presentCount: s.presentCount,
      absentCount: s.absentCount,
      percentage: s.percentage,
      status: s.status,
    });
  }

  console.log("\n--- Testing Semester Attendance Analytics ---");
  const semester = await getSemesterAttendanceAnalytics({});
  console.log("Semester result:", {
    studentsCount: semester.students.length,
    bands: semester.bands,
    summary: semester.summary,
  });
  if (semester.students.length > 0) {
    const s = semester.students[0];
    console.log("Sample semester student:", {
      name: s.name,
      pinNo: s.pinNo,
      totalClasses: s.totalClasses,
      presentCount: s.presentCount,
      absentCount: s.absentCount,
      percentage: s.percentage,
      eligibility: s.eligibility,
    });
  }

  console.log("\n✓ All attendance analytics tabs APIs verified successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
