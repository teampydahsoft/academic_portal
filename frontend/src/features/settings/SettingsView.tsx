"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/components/auth/AuthProvider";

type SettingsSection = {
  title: string;
  description: string;
  href?: string;
  /** User needs any one of these permissions to see the card. */
  permissions?: string[];
};

const sections: SettingsSection[] = [
  {
    title: "User Management",
    description: "Create portal users, link HRMS staff, assign roles, and set college/branch scope.",
    href: "/user-management",
    permissions: ["user_management.view", "user_management.manage_users"],
  },
  {
    title: "Roles & Permissions",
    description: "Manage role definitions and the permission matrix for Academic Portal access.",
    href: "/settings/roles",
    permissions: ["roles.view", "roles.manage"],
  },
  {
    title: "Semester Dates",
    description: "View and update academic start / end dates from Student Database.",
    href: "/settings/semester-dates",
    permissions: ["settings.view", "semester_dates.view", "semester_dates.edit"],
  },
  {
    title: "Faculty & Departments Display",
    description: "Enable which HRMS employee groups appear on Faculty & Departments.",
    href: "/settings/faculty-display",
    permissions: ["settings.view", "settings.edit"],
  },
  {
    title: "Request Workflows",
    description: "Configure request types and dynamic approval hierarchies.",
    href: "/settings/request-workflows",
    permissions: ["request.workflow.manage"],
  },
  {
    title: "Workload Thresholds",
    description: "Minimum / maximum teaching periods and hours per week for staff workload status.",
    href: "/settings/workload-thresholds",
    permissions: ["settings.view", "settings.edit"],
  },
  {
    title: "Mentoring Complaint Types",
    description: "Manage the dynamic list of complaint/risk types for student mentoring.",
    href: "/settings/complaint-types",
    permissions: ["settings.view", "settings.edit"],
  },
  {
    title: "Attendance Thresholds",
    description: "Risk and posting thresholds (coming soon).",
    permissions: ["settings.view"],
  },
  {
    title: "Academic Configuration",
    description: "College-wide academic defaults (coming soon).",
    permissions: ["settings.view"],
  },
  {
    title: "Integration Status",
    description: "HRMS and database connection health (coming soon).",
    permissions: ["settings.view"],
  },
];

export function SettingsView() {
  const { hasAnyPermission } = useAuth();
  const visibleSections = sections.filter(
    (section) =>
      !section.permissions?.length || hasAnyPermission(...section.permissions),
  );

  return (
    <div>
      <PageHeader
        title="Settings, Roles & Access Control"
        description="Portal configuration, role permissions, thresholds, and integration health."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleSections.map((section) =>
          section.href ? (
            <Link key={section.title} href={section.href} className="block">
              <Card className="h-full transition-colors hover:border-navy-700/40">
                <h3 className="font-semibold text-navy-900">{section.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{section.description}</p>
              </Card>
            </Link>
          ) : (
            <Card key={section.title} className="h-full opacity-80">
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
