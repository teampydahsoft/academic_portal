import { StudentProfileView } from "@/features/students/StudentProfileView";
import { DataErrorState } from "@/components/ui/DataErrorState";
import { fetchApi } from "@/lib/fetch-api";
import type { StudentDetail } from "@/features/students/student-types";

type Props = { params: Promise<{ id: string }> };

export default async function StudentProfilePage({ params }: Props) {
  const { id } = await params;
  try {
    const student = await fetchApi<StudentDetail>(`/students/${id}`);
    return <StudentProfileView student={student} />;
  } catch (error) {
    return (
      <DataErrorState
        title="Unable to load student details."
        message={error instanceof Error ? error.message : "Unknown error"}
      />
    );
  }
}
