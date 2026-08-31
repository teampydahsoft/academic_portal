"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { MentoringStudentRow } from "./types";
import { formatComplaintStatus } from "./utils";

type Props = {
  row: MentoringStudentRow;
};

export function MentoringStudentCard({ row }: Props) {
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-navy-900">{row.name}</h3>
          <p className="text-xs text-slate-500">
            {row.rollNo || row.admissionNo} · {row.branch} · {row.section}
          </p>
        </div>
        <StatusBadge status={row.risk} />
      </div>
      <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Attendance</dt>
          <dd className="font-medium">{row.attendance.toFixed(1)}%</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Mentor</dt>
          <dd className="font-medium">{row.mentor?.name ?? "Not assigned"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-500">Complaint</dt>
          <dd className="font-medium">
            {row.activeCase ? formatComplaintStatus(row.activeCase.status) : "No active complaint"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link href={`/mentoring-risks/${row.id}`}>
          <Button size="sm" variant="secondary">
            Open
          </Button>
        </Link>
        <Link href={`/students/${row.id}`}>
          <Button size="sm" variant="ghost">
            Profile
          </Button>
        </Link>
      </div>
    </article>
  );
}
