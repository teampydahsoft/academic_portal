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
  return status === "present" ? "present" : "absent";
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
          setStudents(
            data.students.map((student) => ({
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
    <div>
      <PageHeader
        title={payload.session.subjectName ?? "Class session"}
        description={`${payload.session.subjectCode ?? "—"} • Section ${payload.session.section ?? "—"} • ${payload.session.date} • ${payload.session.time}${payload.session.slotLabel ? ` • ${payload.session.slotLabel}` : ""}`}
        actions={
          <>
            <Link href="/attendance-posting">
              <Button variant="secondary">Back</Button>
            </Link>
            <Button
              variant="secondary"
              onClick={() =>
                setStudents((prev) => prev.map((s) => ({ ...s, status: "present" })))
              }
            >
              Present All
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                setStudents((prev) => prev.map((s) => ({ ...s, status: "absent" })))
              }
            >
              Absent All
            </Button>
            <Button disabled={busy || students.length === 0} onClick={() => void submit()}>
              {busy ? "Saving…" : payload.posted ? "Update Attendance" : "Submit Attendance"}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex items-center gap-2">
        <StatusBadge status={payload.posted ? "Posted" : "Pending"} />
        <span className="text-sm text-slate-500">
          {payload.session.facultyName ?? "Faculty unassigned"}
          {payload.session.roomLabel ? ` • ${payload.session.roomLabel}` : ""}
        </span>
      </div>

      {error ? <p className="mb-3 text-sm text-critical">{error}</p> : null}
      {saved ? <p className="mb-3 text-sm text-success">{saved}</p> : null}

      {payload.posted ? (
        <label className="mb-4 block max-w-xl text-sm">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Edit reason
          </span>
          <input
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            placeholder="Required when updating a posted session"
            className="h-9 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-navy-800"
          />
        </label>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">Students</p>
          <p className="text-2xl font-semibold text-navy-900">{counts.total}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Present</p>
          <p className="text-2xl font-semibold text-success">{counts.present}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Absent</p>
          <p className="text-2xl font-semibold text-critical">{counts.absent}</p>
        </Card>
      </div>

      <div className="mb-3 max-w-md">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student"
          className="h-9 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-navy-800"
        />
      </div>

      <Card className="p-0">
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No students on this roster.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((student) => (
              <li
                key={student.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-navy-900">{student.name}</p>
                  <p className="text-xs text-slate-500">{student.admissionNo}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MARKS.map((mark) => (
                    <button
                      key={mark}
                      type="button"
                      onClick={() => setStatus(student.id, mark)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-semibold uppercase",
                        student.status === mark
                          ? markClass[mark]
                          : "bg-slate-50 text-slate-400",
                      )}
                    >
                      {mark}
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
