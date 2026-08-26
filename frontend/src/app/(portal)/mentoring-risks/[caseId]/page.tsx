import { MentoringCaseDetailView } from "@/features/mentoring/MentoringCaseDetailView";

type Props = { params: Promise<{ caseId: string }> };

export default async function MentoringCasePage({ params }: Props) {
  const { caseId } = await params;
  return <MentoringCaseDetailView caseId={caseId} />;
}
