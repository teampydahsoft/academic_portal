import { ExamResultsView } from "@/features/results/ExamResultsView";

type Props = { params: Promise<{ examId: string }> };

export default async function ExamResultsPage({ params }: Props) {
  const { examId } = await params;
  return <ExamResultsView examId={examId} />;
}
