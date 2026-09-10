import "dotenv/config";
import { queryAcademic, queryStudent } from "../db/pools.js";

async function main() {
  const plans = await queryAcademic(
    `SELECT batch, course_id, branch_id, year_of_study, semester_number, academic_year_label, count(*) as count 
     FROM ap_timetable_plans 
     GROUP BY batch, course_id, branch_id, year_of_study, semester_number, academic_year_label 
     ORDER BY batch DESC, year_of_study DESC, semester_number DESC LIMIT 20`
  );
  console.log("Plans summary:", plans);

  const entries = await queryAcademic(
    `SELECT e.id, e.plan_id, e.day_of_week, e.entry_type, e.custom_label, e.faculty_staff_link_id, 
            e.subject_id, e.subject_code, e.subject_name, s.slot_type, s.label as slot_label
     FROM ap_timetable_entries e
     INNER JOIN ap_timing_template_slots s ON s.id = COALESCE(e.timing_slot_id, e.period_slot_id)
     LIMIT 25`
  );
  console.log("Sample timetable entries with slots:", entries);

  const nonClassWithFaculty = await queryAcademic(
    `SELECT e.id, e.plan_id, e.day_of_week, e.entry_type, e.custom_label, e.faculty_staff_link_id, 
            e.subject_id, e.subject_code, e.subject_name, s.slot_type, s.label as slot_label
     FROM ap_timetable_entries e
     INNER JOIN ap_timing_template_slots s ON s.id = COALESCE(e.timing_slot_id, e.period_slot_id)
     WHERE s.slot_type <> 'CLASS' OR e.subject_id IS NULL
     LIMIT 25`
  );
  console.log("Non-class or null-subject entries:", nonClassWithFaculty);

  const posts = await queryAcademic(
    `SELECT p.batch, p.year_of_study, p.semester_number, count(*) as posts_count 
     FROM ap_attendance_posts ap 
     INNER JOIN ap_class_sessions cs ON cs.id = ap.class_session_id 
     INNER JOIN ap_timetable_plans p ON p.id = cs.plan_id 
     GROUP BY p.batch, p.year_of_study, p.semester_number`
  );
  console.log("Attendance posts summary:", posts);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
