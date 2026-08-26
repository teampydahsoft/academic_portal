import "dotenv/config";
import { getCommandCenterSummary } from "../services/command-center.service.js";
import { listStudents } from "../services/students.service.js";
import { getWorkloadSummary } from "../services/workload.service.js";
import { getTimetablePlanner } from "../services/timetables.service.js";

async function main() {
  const summary = await getCommandCenterSummary();
  console.log("command-center", summary);

  const students = await listStudents("", 3, 0);
  console.log("students", students.total, students.data.length, students.data[0]);

  const workload = await getWorkloadSummary();
  console.log("workload faculty", workload.kpis);

  const planner = await getTimetablePlanner();
  console.log("timetable entries", planner.entryCount, planner.context);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
