import { ExaminationDetailView } from "@/features/examinations/ExaminationDetailView";

type Props = { params: Promise<{ examId: string }> };

export default async function ExaminationDetailPage({ params }: Props) {
  const { examId } = await params;
  return <ExaminationDetailView examId={examId} />;
}
