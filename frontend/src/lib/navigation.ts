import {
  AlertTriangle,
  Bell,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  FileBarChart2,
  Gauge,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  Briefcase,
  LineChart,
  Layers3,
  ShieldAlert,
  UserCog,
  Clock3,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  /** Any of these permissions unlocks the nav item (UX only). */
  permissions?: string[];
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        permissions: ["dashboard.view"],
      },
    ],
  },
  {
    title: "Academics",
    items: [
      {
        label: "Students",
        href: "/students",
        icon: GraduationCap,
        permissions: ["students.view"],
      },
      {
        label: "My Timetable",
        href: "/my-timetable",
        icon: CalendarCheck,
        permissions: ["my_timetable.view"],
      },
      {
        label: "Attendance Calendar",
        href: "/attendance-calendar",
        icon: CalendarRange,
        permissions: ["attendance_calendar.view"],
      },
      {
        label: "Timetables",
        href: "/timetables",
        icon: CalendarDays,
        permissions: ["timetable.view"],
      },
      {
        label: "Staff Workload",
        href: "/staff-workload",
        icon: Briefcase,
        permissions: ["workload.view"],
      },
      {
        label: "Attendance Posting",
        href: "/attendance-posting",
        icon: ClipboardCheck,
        permissions: ["attendance.view", "attendance.post"],
      },
      {
        label: "Attendance Analytics",
        href: "/attendance-analytics",
        icon: LineChart,
        permissions: ["attendance_analytics.view"],
      },
      {
        label: "Faculty & Departments",
        href: "/faculty-departments",
        icon: Users,
        permissions: ["faculty.view"],
      },
      {
        label: "Curriculum & Subjects",
        href: "/curriculum-subjects",
        icon: BookOpen,
        permissions: ["catalog.view"],
      },
    ],
  },
  {
    title: "Requests",
    items: [
      {
        label: "My Requests",
        href: "/requests",
        icon: Inbox,
        permissions: ["request.view"],
      },
      {
        label: "Pending Requests",
        href: "/requests/pending",
        icon: Clock3,
        permissions: ["request.approve"],
      },
    ],
  },
  {
    title: "Examinations",
    items: [
      {
        label: "Examinations",
        href: "/examinations",
        icon: Layers3,
        permissions: ["examinations.view"],
      },
      {
        label: "Results",
        href: "/results",
        icon: Gauge,
        permissions: ["results.view"],
      },
    ],
  },
  {
    title: "Student Support",
    items: [
      {
        label: "Mentoring & Risks",
        href: "/mentoring-risks",
        icon: ShieldAlert,
        permissions: ["mentoring.view", "students.view"],
      },
    ],
  },
  {
    title: "Operations",
    items: [
      {
        label: "Pending & Exceptions",
        href: "/pending-exceptions",
        icon: AlertTriangle,
        permissions: ["pending_exceptions.view"],
      },
      {
        label: "Reports",
        href: "/reports",
        icon: FileBarChart2,
        permissions: ["reports.view"],
      },
      {
        label: "Alerts",
        href: "/alerts",
        icon: Bell,
        permissions: ["alerts.view"],
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        label: "User Management",
        href: "/user-management",
        icon: UserCog,
        permissions: ["user_management.view", "user_management.manage_users"],
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        permissions: ["settings.view"],
      },
    ],
  },
];

/** Sidebar routes shown to teaching staff without institute-wide admin permissions. */
export const TEACHING_STAFF_NAV_HREFS = new Set([
  "/dashboard",
  "/my-timetable",
  "/attendance-posting",
  "/requests",
  "/mentoring-risks",
]);

export function filterNavGroups(
  groups: NavGroup[],
  hasAnyPermission: (...permissions: string[]) => boolean,
  options?: { teachingStaffOnly?: boolean },
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (options?.teachingStaffOnly && !TEACHING_STAFF_NAV_HREFS.has(item.href)) {
          return false;
        }
        if (!item.permissions?.length) return true;
        return hasAnyPermission(...item.permissions);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
