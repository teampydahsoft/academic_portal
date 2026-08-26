import { DepartmentDetailView } from "@/features/faculty-departments/DepartmentDetailView";

type Props = { params: Promise<{ departmentId: string }> };

export default async function DepartmentPage({ params }: Props) {
  const { departmentId } = await params;
  return <DepartmentDetailView departmentId={decodeURIComponent(departmentId)} />;
}
