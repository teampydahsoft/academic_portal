import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

type Props = {
  title?: string;
  message: string;
};

export function DataErrorState({
  title = "Unable to load live data",
  message,
}: Props) {
  return (
    <div>
      <PageHeader
        title={title}
        description="Ensure the backend API is running and database credentials are valid."
      />
      <Card>
        <p className="text-sm text-critical">{message}</p>
      </Card>
    </div>
  );
}
