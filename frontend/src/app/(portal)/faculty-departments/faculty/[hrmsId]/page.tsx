import { FacultyDetailView } from "@/features/faculty-departments/FacultyDetailView";

type Props = { params: Promise<{ hrmsId: string }> };

export default async function FacultyDetailPage({ params }: Props) {
  const { hrmsId } = await params;
  return <FacultyDetailView hrmsId={decodeURIComponent(hrmsId)} />;
}
