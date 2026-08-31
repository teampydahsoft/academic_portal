import { StatCard } from "@/components/ui/StatCard";

type Props = {
  classesToday: number;
  periodsThisWeek: number;
  theory: number;
  lab: number;
};

export function TimetableSummary({
  classesToday,
  periodsThisWeek,
  theory,
  lab,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard label="Today's classes" value={classesToday} tone="info" />
      <StatCard label="Periods this week" value={periodsThisWeek} />
      <StatCard label="Theory classes" value={theory} />
      <StatCard label="Lab classes" value={lab} />
    </div>
  );
}
