"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  isActive: boolean;
  linkStatus: "linked" | "unlinked";
};

type Department = {
  id: string;
  key: string;
  name: string;
  division: string;
  facultyCount: number;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

type View = "departments" | "faculty";

const PAGE_SIZE = 25;

export function FacultyDepartmentsView() {
  const router = useRouter();
  const [view, setView] = useState<View>("departments");
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });
  const [kpis, setKpis] = useState({
    totalFaculty: 0,
    linkedCount: 0,
    unlinkedCount: 0,
  });
  const [enabledGroupCount, setEnabledGroupCount] = useState(0);
  const [usingDefaultGroups, setUsingDefaultGroups] = useState(true);
  const [divisionOptions, setDivisionOptions] = useState<string[]>([]);
  const [deptOptions, setDeptOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [page, setPage] = useState(1);
  const [deptPage, setDeptPage] = useState(1);
  const [deptSearchDraft, setDeptSearchDraft] = useState("");
  const [deptSearch, setDeptSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDeptSearch(deptSearchDraft.trim().toLowerCase());
      setDeptPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [deptSearchDraft]);

  useEffect(() => {
    let cancelled = false;
    async function loadDepartments() {
      if (view === "departments") setLoading(true);
      setError(null);
      try {
        const deptRes = await apiFetch(`/faculty/departments`, {
          cache: "no-store",
        });
        if (!deptRes.ok) throw new Error(`Departments failed (${deptRes.status})`);
        const deptBody = (await deptRes.json()) as {
          data: Department[];
          enabledGroupCount?: number;
          usingDefaultGroups?: boolean;
          kpis?: { totalFaculty: number; linkedCount: number; unlinkedCount: number };
        };
        if (!cancelled) {
          const rows = deptBody.data ?? [];
          setDepartments(rows);
          if (view === "departments") {
            setEnabledGroupCount(deptBody.enabledGroupCount ?? 0);
            setUsingDefaultGroups(deptBody.usingDefaultGroups ?? true);
            if (deptBody.kpis) setKpis(deptBody.kpis);
            setDivisionOptions(
              [...new Set(rows.map((r) => r.division).filter(Boolean))].sort(),
            );
            setDeptOptions(
              [...new Set(rows.map((r) => r.name).filter(Boolean))].sort(),
            );
          }
        }
      } catch (err) {
        if (!cancelled && view === "departments") {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled && view === "departments") setLoading(false);
      }
    }
    void loadDepartments();
    return () => {
      cancelled = true;
    };
  }, [view]);

  useEffect(() => {
    if (view !== "faculty") return;
    let cancelled = false;
    async function loadFaculty() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(PAGE_SIZE));
        if (divisionFilter !== "all") params.set("division", divisionFilter);
        if (deptFilter !== "all") params.set("department", deptFilter);
        if (linkFilter !== "all") params.set("linkStatus", linkFilter);
        if (search) params.set("search", search);

        const facRes = await apiFetch(`/faculty?${params.toString()}`, {
          cache: "no-store",
        });
        if (!facRes.ok) throw new Error(`Faculty list failed (${facRes.status})`);

        const facBody = (await facRes.json()) as {
          data: FacultyRow[];
          enabledGroupCount?: number;
          usingDefaultGroups?: boolean;
          pagination: Pagination;
          kpis: { totalFaculty: number; linkedCount: number; unlinkedCount: number };
          filterOptions: { divisions: string[]; departments: string[] };
        };

        if (!cancelled) {
          setFaculty(facBody.data ?? []);
          setEnabledGroupCount(facBody.enabledGroupCount ?? 0);
          setUsingDefaultGroups(facBody.usingDefaultGroups ?? true);
          setPagination(
            facBody.pagination ?? {
              page: 1,
              pageSize: PAGE_SIZE,
              total: 0,
              totalPages: 1,
              hasNext: false,
              hasPrev: false,
            },
          );
          setKpis(
            facBody.kpis ?? {
              totalFaculty: 0,
              linkedCount: 0,
              unlinkedCount: 0,
            },
          );
          setDivisionOptions(facBody.filterOptions?.divisions ?? []);
          setDeptOptions(facBody.filterOptions?.departments ?? []);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadFaculty();
    return () => {
      cancelled = true;
    };
  }, [view, page, divisionFilter, deptFilter, linkFilter, search]);

  const filteredDepartments = useMemo(() => {
    return departments.filter((d) => {
      if (divisionFilter !== "all" && d.division !== divisionFilter) return false;
      if (deptFilter !== "all" && d.name !== deptFilter) return false;
      if (deptSearch) {
        const q = deptSearch;
        if (
          !d.name.toLowerCase().includes(q) &&
          !d.division.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [departments, deptSearch, divisionFilter, deptFilter]);

  const visibleDeptOptions = useMemo(() => {
    if (divisionFilter === "all") return deptOptions;
    if (departments.length === 0) return deptOptions; // Fallback if departments not loaded yet
    
    return [
      ...new Set(
        departments
          .filter((d) => d.division === divisionFilter)
          .map((d) => d.name)
          .filter(Boolean),
      ),
    ].sort();
  }, [deptOptions, divisionFilter, departments]);

  // Keep department page in range when filters shrink the list
  useEffect(() => {
    setDeptPage(1);
  }, [divisionFilter, deptFilter, deptSearch]);

  // Drop department filter if it isn't valid for the selected division
  useEffect(() => {
    if (view !== "departments" || deptFilter === "all") return;
    if (!visibleDeptOptions.includes(deptFilter)) setDeptFilter("all");
  }, [view, deptFilter, visibleDeptOptions]);

  const deptTotalPages = Math.max(1, Math.ceil(filteredDepartments.length / PAGE_SIZE));
  const safeDeptPage = Math.min(deptPage, deptTotalPages);
  const pagedDepartments = useMemo(() => {
    const start = (safeDeptPage - 1) * PAGE_SIZE;
    return filteredDepartments.slice(start, start + PAGE_SIZE);
  }, [filteredDepartments, safeDeptPage]);

  const pageLabel = useMemo(() => {
    if (pagination.total === 0) return "0 shown";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
    return `${start}–${end} of ${pagination.total}`;
  }, [pagination]);

  const deptPageLabel = useMemo(() => {
    if (filteredDepartments.length === 0) return "0 shown";
    const start = (safeDeptPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(safeDeptPage * PAGE_SIZE, filteredDepartments.length);
    return `${start}–${end} of ${filteredDepartments.length}`;
  }, [filteredDepartments.length, safeDeptPage]);

  return (
    <div>
      <PageHeader
        title="Faculty & Departments"
        description={
          usingDefaultGroups
            ? "Showing teaching-group defaults from HRMS. Change enabled groups in Display settings."
            : `Showing employees from ${enabledGroupCount} enabled HRMS employee group${enabledGroupCount === 1 ? "" : "s"}.`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings/faculty-display">
              <Button size="sm" variant="secondary">
                Display settings
              </Button>
            </Link>
            <Button
              size="sm"
              variant={view === "departments" ? "primary" : "secondary"}
              onClick={() => setView("departments")}
            >
              Departments
            </Button>
            <Button
              size="sm"
              variant={view === "faculty" ? "primary" : "secondary"}
              onClick={() => setView("faculty")}
            >
              Faculty
            </Button>
          </div>
        }
      />

      {error && <p className="mb-3 text-sm text-critical">{error}</p>}
      {loading && <p className="mb-3 text-sm text-slate-500">Loading from HRMS…</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total Faculty</p>
          <p className="mt-2 text-2xl font-semibold text-navy-900">{kpis.totalFaculty}</p>
          <p className="mt-1 text-xs text-slate-500">
            {usingDefaultGroups
              ? "Teaching-group defaults (Settings)"
              : `From ${enabledGroupCount} enabled group${enabledGroupCount === 1 ? "" : "s"}`}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Linked (AP)</p>
          <p className="mt-2 text-2xl font-semibold text-navy-900">{kpis.linkedCount}</p>
          <p className="mt-1 text-xs text-slate-500">In ap_staff_link</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Not yet linked</p>
          <p className="mt-2 text-2xl font-semibold text-navy-900">{kpis.unlinkedCount}</p>
          <p className="mt-1 text-xs text-slate-500">No timetable assignment yet</p>
        </Card>
      </div>

      {view === "departments" ? (
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="search"
              placeholder="Search department or division…"
              value={deptSearchDraft}
              onChange={(e) => setDeptSearchDraft(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-navy-800"
            />
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-1 focus:ring-navy-800"
            >
              <option value="all">All Divisions</option>
              {divisionOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-1 focus:ring-navy-800"
            >
              <option value="all">All Departments</option>
              {visibleDeptOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="ml-auto self-center text-xs text-slate-500">{deptPageLabel}</span>
          </div>

          <DataTable
            rows={pagedDepartments}
            rowKey={(r) => r.id}
            emptyMessage="No departments found."
            onRowClick={(row) => router.push(`/faculty-departments/${row.id}`)}
            mobileRender={(row) => (
              <div className="flex flex-col gap-1">
                <MobileDataCardHeader title={row.name} />
                <MobileDataCardGrid>
                  <MobileDataCardField label="Division / Campus" value={row.division} />
                  <MobileDataCardField label="Faculty" value={row.facultyCount} />
                </MobileDataCardGrid>
                <MobileDataCardActions>
                  <Link href={`/faculty-departments/${row.id}`} onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="secondary">View</Button>
                  </Link>
                </MobileDataCardActions>
              </div>
            )}
            columns={[
              {
                key: "name",
                header: "Department",
                render: (row) => (
                  <p className="font-medium text-navy-900">{row.name}</p>
                ),
              },
              {
                key: "division",
                header: "Division / Campus",
                render: (row) => row.division,
              },
              {
                key: "count",
                header: "Faculty",
                render: (row) => (
                  <span className="tabular-nums text-navy-900">{row.facultyCount}</span>
                ),
              },
              {
                key: "actions",
                header: "",
                render: (row) => (
                  <Link
                    href={`/faculty-departments/${row.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button size="sm" variant="secondary">
                      View
                    </Button>
                  </Link>
                ),
              },
            ]}
          />

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Page {safeDeptPage} of {deptTotalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={safeDeptPage <= 1 || loading}
                onClick={() => setDeptPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={safeDeptPage >= deptTotalPages || loading}
                onClick={() => setDeptPage((p) => Math.min(deptTotalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="search"
              placeholder="Search name, code, ID, division, group…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-navy-800"
            />
            <select
              value={divisionFilter}
              onChange={(e) => {
                setDivisionFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-1 focus:ring-navy-800"
            >
              <option value="all">All Divisions</option>
              {divisionOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={deptFilter}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-1 focus:ring-navy-800"
            >
              <option value="all">All Departments</option>
              {visibleDeptOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={linkFilter}
              onChange={(e) => {
                setLinkFilter(e.target.value as "all" | "linked" | "unlinked");
                setPage(1);
              }}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-1 focus:ring-navy-800"
            >
              <option value="all">All link status</option>
              <option value="linked">Linked (AP)</option>
              <option value="unlinked">Not linked</option>
            </select>
            <span className="ml-auto self-center text-xs text-slate-500">{pageLabel}</span>
          </div>

          <DataTable
            rows={faculty}
            rowKey={(r) => r.hrmsEmployeeId}
            emptyMessage="No faculty match the current filters."
            mobileRender={(row) => (
              <div className="flex flex-col gap-1">
                <MobileDataCardHeader
                  title={row.name}
                  secondary={row.code}
                  status={
                    <StatusBadge
                      status={row.staffLinkId ? "active" : "inactive"}
                    />
                  }
                />
                <MobileDataCardGrid>
                  <MobileDataCardField label="Division" value={row.division} />
                  <MobileDataCardField label="Department" value={row.department} />
                  <MobileDataCardField label="Designation" value={row.designation} />
                  <MobileDataCardField label="Group" value={row.employeeGroup || "—"} />
                </MobileDataCardGrid>
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
              { key: "dept", header: "Department", render: (r) => r.department },
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

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={!pagination.hasPrev || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!pagination.hasNext || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
