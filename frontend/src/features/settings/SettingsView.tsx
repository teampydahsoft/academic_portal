import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

const sections = [
  {
    title: "User Management",
    description: "Link HRMS users, assign Academic Portal roles, and manage college/branch scope.",
    href: "/user-management",
  },
  {
    title: "Semester Dates",
    description: "View and update academic start / end dates from Student Database.",
    href: "/settings/semester-dates",
  },
  {
    title: "Faculty & Departments Display",
    description:
      "Enable which HRMS employee groups appear on Faculty & Departments.",
    href: "/settings/faculty-display",
  },
  {
    title: "Roles",
    description: "Managed via User Management (role → permission matrix is server-side).",
  },
  {
    title: "Permissions",
    description: "Read-only derived permissions are shown on each user in User Management.",
  },
  {
    title: "Attendance Thresholds",
    description: "Configuration panel",
  },
  {
    title: "Workload Thresholds",
    description: "Configuration panel",
  },
  {
    title: "Academic Configuration",
    description: "Configuration panel",
  },
  {
    title: "Integration Status",
    description: "Configuration panel",
  },
];

export function SettingsView() {
  return (
    <div>
      <PageHeader
        title="Settings, Roles & Access Control"
        description="Configuration for roles, thresholds and integration health. Database credentials are not exposed here."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) =>
          section.href ? (
            <Link key={section.title} href={section.href} className="block">
              <Card className="h-full transition-colors hover:border-navy-700/40">
                <h3 className="font-semibold text-navy-900">{section.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{section.description}</p>
              </Card>
            </Link>
          ) : (
            <Card key={section.title}>
              <h3 className="font-semibold text-navy-900">{section.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{section.description}</p>
            </Card>
          ),
        )}
      </div>
      <p className="mt-4 text-sm text-slate-500">
        College timing schedules are managed from{" "}
        <Link href="/timetables" className="text-navy-800 hover:underline">
          Timetable Planning → Edit Timings
        </Link>
        .
      </p>
    </div>
  );
}
