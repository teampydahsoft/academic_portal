"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import {
  MobileDataCardHeader,
  MobileDataCardGrid,
  MobileDataCardField,
  MobileDataCardActions,
} from "@/components/ui/MobileDataCard";
import { apiFetch } from "@/lib/api";

type FacultyRow = {
  hrmsEmployeeId: string;
  staffLinkId: number | null;
  name: string;
  code: string;
  division: string;
  department: string;
  designation: string;
  college: string;
  employeeGroup: string;
  linkStatus: "linked" | "unlinked";
};

type DeptDetail = {
  key: string;
  division: string;
  name: string;
  facultyCount: number;
  linkedCount: number;
  unlinkedCount: number;
  faculty: FacultyRow[];
};

type Props = { departmentId: string };

export function DepartmentDetailView({ departmentId }: Props) {
  const [detail, setDetail] = useState<DeptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [linkFilter, setLinkFilter] = useState<"all" | "linked" | "unlinked">("all");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/faculty/departments/${encodeURIComponent(departmentId)}`,
          { cache: "no-store" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { message?: string }).message ?? `Error ${res.status}`);
        if (!cancelled) setDetail(body as DeptDetail);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [departmentId]);

  const filteredFaculty = useMemo(() => {
    if (!detail) return [];
    return detail.faculty.filter((row) => {
      if (linkFilter !== "all" && row.linkStatus !== linkFilter) return false;
      if (!search) return true;
      return (
        row.name.toLowerCase().includes(search) ||
        row.code.toLowerCase().includes(search) ||
        row.hrmsEmployeeId.toLowerCase().includes(search) ||
        row.designation.toLowerCase().includes(search) ||
        row.employeeGroup.toLowerCase().includes(search) ||
        row.division.toLowerCase().includes(search)
      );
    });
  }, [detail, search, linkFilter]);

  if (loading) return <p className="text-sm text-slate-500">Loading department…</p>;

  if (error || !detail) {
    return (
      <div>
        <PageHeader title="Department" />
        <Card>
          <p className="text-sm text-critical">{error ?? "Department not found."}</p>
          <Link href="/faculty-departments" className="mt-3 inline-block">
            <Button size="sm" variant="secondary">
              Back
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={detail.name}
        description={`${detail.division} · ${detail.facultyCount} faculty from HRMS`}
        actions={
          <Link href="/faculty-departments">
            <Button size="sm" variant="secondary">
              Back
            </Button>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Faculty</p>
          <p className="mt-2 text-2xl font-semibold text-navy-900">{detail.facultyCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Division</p>
          <p className="mt-2 text-sm font-semibold text-navy-900">{detail.division}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">AP Linked</p>
          <p className="mt-2 text-2xl font-semibold text-navy-900">{detail.linkedCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Not Linked</p>
          <p className="mt-2 text-2xl font-semibold text-navy-900">{detail.unlinkedCount}</p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search name, code, ID, designation, group…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-navy-800"
        />
        <select
          value={linkFilter}
          onChange={(e) => setLinkFilter(e.target.value as "all" | "linked" | "unlinked")}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-1 focus:ring-navy-800"
        >
          <option value="all">All link status</option>
          <option value="linked">Linked (AP)</option>
          <option value="unlinked">Not linked</option>
        </select>
        <span className="ml-auto self-center text-xs text-slate-500">
          {filteredFaculty.length === detail.faculty.length
            ? `${filteredFaculty.length} employees`
            : `${filteredFaculty.length} of ${detail.faculty.length} employees`}
        </span>
      </div>

      <DataTable
        rows={filteredFaculty}
        rowKey={(r) => r.hrmsEmployeeId}
        emptyMessage={
          detail.faculty.length === 0
            ? "No faculty in this department."
            : "No employees match the current search."
        }
        mobileRender={(row) => (
          <div className="flex flex-col gap-1">
            <MobileDataCardHeader
              title={row.name}
              secondary={row.code}
              status={<StatusBadge status={row.linkStatus === "linked" ? "Active" : "Pending"} />}
            />
            <MobileDataCardGrid>
              <MobileDataCardField label="Division" value={row.division} />
              <MobileDataCardField label="Designation" value={row.designation} />
              <MobileDataCardField label="Group" value={row.employeeGroup || "—"} />
            </MobileDataCardGrid>
            <MobileDataCardActions>
              <Link href={`/faculty-departments/faculty/${row.hrmsEmployeeId}`}>
                <Button size="sm" variant="secondary">View</Button>
              </Link>
            </MobileDataCardActions>
          </div>
        )}
        columns={[
          {
            key: "name",
            header: "Faculty",
            render: (row) => (
              <div>
                <p className="font-medium text-navy-900">{row.name}</p>
                <p className="text-xs text-slate-500">{row.code}</p>
              </div>
            ),
          },
          { key: "division", header: "Division", render: (r) => r.division },
          { key: "desig", header: "Designation", render: (r) => r.designation },
          { key: "group", header: "Group", render: (r) => r.employeeGroup },
          {
            key: "link",
            header: "AP Link",
            render: (r) => (
              <StatusBadge status={r.linkStatus === "linked" ? "Active" : "Pending"} />
            ),
          },
          {
            key: "actions",
            header: "",
            render: (r) => (
              <Link href={`/faculty-departments/faculty/${r.hrmsEmployeeId}`}>
                <Button size="sm" variant="secondary">
                  View
                </Button>
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}
