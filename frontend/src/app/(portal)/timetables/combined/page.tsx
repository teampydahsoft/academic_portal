import { CombinedTimetableCreationView } from "@/features/timetables/CombinedTimetableCreationView";

export const metadata = {
  title: "Combined Classes Timetable | Pydah Academic Portal",
  description: "Create and publish combined timetable schedules across multiple branches with common years and semesters.",
};

export default function CombinedTimetablePage() {
  return <CombinedTimetableCreationView />;
}
