import { redirect } from "next/navigation";

/** Legacy route — Attendance Calendar replaces Academic Calendar. */
export default function LegacyAcademicCalendarPage() {
  redirect("/attendance-calendar");
}
