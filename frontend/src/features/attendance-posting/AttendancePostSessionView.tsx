"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type AttendanceMark = "present" | "absent";

type StudentMark = {
  id: string;
  studentDbId: number;
  name: string;
  admissionNo: string;
  status: AttendanceMark;
  remarks: string | null;
};

type Payload = {
  session: {
    id: number;
    subjectName: string | null;
    subjectCode: string | null;
    section: string | null;
    slotLabel: string | null;
    time: string;
    date: string;
    facultyName: string | null;
    roomLabel: string | null;
    studentCount: number;
    posted: boolean;
  };
  posted: boolean;
  students: StudentMark[];
};

const MARKS: AttendanceMark[] = ["present", "absent"];

const markClass: Record<AttendanceMark, string> = {
  present: "bg-green-50 text-success",
  absent: "bg-red-50 text-critical",
};

function normalizeStatus(status: string | null | undefined): AttendanceMark {
  return status === "absent" ? "absent" : "present";
}

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AttendancePostSessionView() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const [payload, setPayload] = useState<Payload | null>(null);
  const [students, setStudents] = useState<StudentMark[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editReason, setEditReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/attendance/sessions/${encodeURIComponent(sessionId)}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : "Unable to load class session",
          );
        }
        if (!cancelled) {
          const data = body as Payload;
          setPayload(data);
          
          const sortedStudents = [...data.students].sort((a, b) => 
            a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true, sensitivity: 'base' })
          );
          
          setStudents(
            sortedStudents.map((student) => ({
              ...student,
              status: normalizeStatus(student.status),
            })),
          );
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.admissionNo.toLowerCase().includes(q),
    );
  }, [students, query]);

  const counts = useMemo(() => {
    return {
      total: students.length,
      present: students.filter((s) => s.status === "present").length,
      absent: students.filter((s) => s.status === "absent").length,
    };
  }, [students]);

  function setStatus(id: string, status: AttendanceMark) {
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    setSaved(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const response = await apiFetch(`/attendance/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            editReason: payload?.posted ? editReason : undefined,
            students: students.map((s) => ({
              studentDbId: s.studentDbId,
              admissionNumber: s.admissionNo,
              status: s.status,
            })),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body && "message" in body
            ? String((body as { message: string }).message)
            : "Failed to save attendance",
        );
      }
      setSaved(
        `Saved ${body.total} marks • Present ${body.present} • Absent ${body.absent}`,
      );
      setPayload((prev) => (prev ? { ...prev, posted: true } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save attendance");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading class roster…</p>;
  }

  if (error && !payload) {
    return (
      <div>
        <PageHeader title="Attendance session" />
        <Card>
          <p className="text-sm text-critical">{error}</p>
          <Link href="/attendance-posting" className="mt-3 inline-block text-sm text-navy-800">
            Back to sessions
          </Link>
        </Card>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex-none pb-2">
        <PageHeader
          title={payload.session.subjectName ?? "Class session"}
          description={`${payload.session.subjectCode ?? "—"} • Section ${payload.session.section ?? "—"} • ${payload.session.date} • ${payload.session.time}${payload.session.slotLabel ? ` • ${payload.session.slotLabel}` : ""}`}
          actions={
            <>
              <Link href="/attendance-posting">
                <Button variant="secondary" className="px-2 py-1 text-xs">Back</Button>
              </Link>
              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() =>
                  setStudents((prev) => prev.map((s) => ({ ...s, status: "present" })))
                }
              >
                Present All
              </Button>
              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() =>
                  setStudents((prev) => prev.map((s) => ({ ...s, status: "absent" })))
                }
              >
                Absent All
              </Button>
              <Button className="px-2 py-1 text-xs" disabled={busy || students.length === 0} onClick={() => void submit()}>
                {busy ? "Saving…" : payload.posted ? "Update" : "Submit"}
              </Button>
            </>
          }
        />

        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={payload.posted ? "Posted" : "Pending"} />
            <span className="text-xs text-slate-500 truncate max-w-[150px] sm:max-w-none">
              {payload.session.facultyName ?? "Faculty unassigned"}
              {payload.session.roomLabel ? ` • ${payload.session.roomLabel}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-medium">
            <span className="text-navy-900">Total: {counts.total}</span>
            <span className="text-success">P: {counts.present}</span>
            <span className="text-critical">A: {counts.absent}</span>
          </div>
        </div>

        {error ? <p className="mb-2 text-xs text-critical">{error}</p> : null}
        {saved ? <p className="mb-2 text-xs text-success">{saved}</p> : null}

        {payload.posted ? (
          <div className="mb-2 max-w-xl">
            <input
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="Edit reason (Required when updating)"
              className="h-8 w-full rounded-md border border-border px-3 text-xs outline-none focus:border-navy-800"
            />
          </div>
        ) : null}

        <div className="mb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search student..."
            className="h-8 w-full rounded-md border border-border px-3 text-xs outline-none focus:border-navy-800 bg-slate-50"
          />
        </div>
      </div>

      <Card className="flex-1 overflow-y-auto p-0">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 text-center">No students on this roster.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((student) => (
              <li
                key={student.id}
                className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3 hover:bg-slate-50/50"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-800">
                    {getInitials(student.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-navy-900" title={student.name}>
                      {student.name}
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium">
                      {student.admissionNo}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center rounded-lg border border-border p-0.5 bg-slate-50">
                  {MARKS.map((mark) => (
                    <button
                      key={mark}
                      type="button"
                      onClick={() => setStatus(student.id, mark)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-xs font-bold uppercase transition-colors",
                        student.status === mark
                          ? markClass[mark] + " shadow-sm ring-1 ring-black/5"
                          : "text-slate-500 hover:text-slate-700 hover:bg-slate-100",
                      )}
                    >
                      {mark === "present" ? "P" : "A"}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
