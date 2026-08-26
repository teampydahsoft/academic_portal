import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StudentDetailBody } from "@/features/students/StudentDetailDrawer";
import { StudentExaminationsPanel } from "@/features/examinations/StudentExaminationsPanel";
import { StudentResultsPanel } from "@/features/results/StudentResultsPanel";
import type { StudentDetail } from "@/features/students/student-types";

type Props = {
  student: StudentDetail;
};

export function StudentProfileView({ student }: Props) {
  return (
    <div>
      <PageHeader
        title="Student Details"
        description="Record loaded from student_database."
        actions={
          <Link href="/students">
            <Button size="sm" variant="secondary">
              Back to register
            </Button>
          </Link>
        }
      />

      <Card className="overflow-hidden p-0">
        <StudentDetailBody student={student} />
      </Card>

      <StudentExaminationsPanel studentId={student.id} />
      <StudentResultsPanel rollNumber={student.rollNo} />
    </div>
  );
}
