import { RequestDetailView } from "@/features/requests/RequestDetailView";

type Props = { params: Promise<{ id: string }> };

export default async function RequestDetailPage({ params }: Props) {
  const { id } = await params;
  return <RequestDetailView requestId={id} />;
}
