import React from "react";
import { cn } from "@/lib/cn";

export type RoleStyle = {
  badge: string;
  pill: string;
  iconBg: string;
  iconText: string;
  cardActive: string;
  dot: string;
  border: string;
  bgLight: string;
};

export const ROLE_STYLES: Record<string, RoleStyle> = {
  super_admin: {
    badge: "bg-purple-50 text-purple-800 border-purple-200/80 ring-1 ring-purple-400/20",
    pill: "bg-purple-100 text-purple-800",
    iconBg: "bg-purple-100 text-purple-700",
    iconText: "text-purple-700",
    cardActive: "border-purple-400 bg-white shadow-sm ring-2 ring-purple-200",
    dot: "bg-purple-500",
    border: "border-purple-200",
    bgLight: "bg-purple-50/50",
  },
  system_admin: {
    badge: "bg-purple-50 text-purple-800 border-purple-200/80 ring-1 ring-purple-400/20",
    pill: "bg-purple-100 text-purple-800",
    iconBg: "bg-purple-100 text-purple-700",
    iconText: "text-purple-700",
    cardActive: "border-purple-400 bg-white shadow-sm ring-2 ring-purple-200",
    dot: "bg-purple-500",
    border: "border-purple-200",
    bgLight: "bg-purple-50/50",
  },
  principal: {
    badge: "bg-amber-50 text-amber-900 border-amber-200/80 ring-1 ring-amber-400/20",
    pill: "bg-amber-100 text-amber-900",
    iconBg: "bg-amber-100 text-amber-800",
    iconText: "text-amber-800",
    cardActive: "border-amber-400 bg-white shadow-sm ring-2 ring-amber-200",
    dot: "bg-amber-500",
    border: "border-amber-200",
    bgLight: "bg-amber-50/50",
  },
  auditor: {
    badge: "bg-amber-50 text-amber-900 border-amber-200/80 ring-1 ring-amber-400/20",
    pill: "bg-amber-100 text-amber-900",
    iconBg: "bg-amber-100 text-amber-800",
    iconText: "text-amber-800",
    cardActive: "border-amber-400 bg-white shadow-sm ring-2 ring-amber-200",
    dot: "bg-amber-500",
    border: "border-amber-200",
    bgLight: "bg-amber-50/50",
  },
  vice_principal: {
    badge: "bg-blue-50 text-blue-800 border-blue-200/80 ring-1 ring-blue-400/20",
    pill: "bg-blue-100 text-blue-800",
    iconBg: "bg-blue-100 text-blue-700",
    iconText: "text-blue-700",
    cardActive: "border-blue-400 bg-white shadow-sm ring-2 ring-blue-200",
    dot: "bg-blue-500",
    border: "border-blue-200",
    bgLight: "bg-blue-50/50",
  },
  management: {
    badge: "bg-blue-50 text-blue-800 border-blue-200/80 ring-1 ring-blue-400/20",
    pill: "bg-blue-100 text-blue-800",
    iconBg: "bg-blue-100 text-blue-700",
    iconText: "text-blue-700",
    cardActive: "border-blue-400 bg-white shadow-sm ring-2 ring-blue-200",
    dot: "bg-blue-500",
    border: "border-blue-200",
    bgLight: "bg-blue-50/50",
  },
  academic_admin: {
    badge: "bg-blue-50 text-blue-800 border-blue-200/80 ring-1 ring-blue-400/20",
    pill: "bg-blue-100 text-blue-800",
    iconBg: "bg-blue-100 text-blue-700",
    iconText: "text-blue-700",
    cardActive: "border-blue-400 bg-white shadow-sm ring-2 ring-blue-200",
    dot: "bg-blue-500",
    border: "border-blue-200",
    bgLight: "bg-blue-50/50",
  },
  hod: {
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200/80 ring-1 ring-emerald-400/20",
    pill: "bg-emerald-100 text-emerald-800",
    iconBg: "bg-emerald-100 text-emerald-700",
    iconText: "text-emerald-700",
    cardActive: "border-emerald-400 bg-white shadow-sm ring-2 ring-emerald-200",
    dot: "bg-emerald-500",
    border: "border-emerald-200",
    bgLight: "bg-emerald-50/50",
  },
  staff: {
    badge: "bg-cyan-50 text-cyan-800 border-cyan-200/80 ring-1 ring-cyan-400/20",
    pill: "bg-cyan-100 text-cyan-800",
    iconBg: "bg-cyan-100 text-cyan-700",
    iconText: "text-cyan-700",
    cardActive: "border-cyan-400 bg-white shadow-sm ring-2 ring-cyan-200",
    dot: "bg-cyan-500",
    border: "border-cyan-200",
    bgLight: "bg-cyan-50/50",
  },
  faculty: {
    badge: "bg-cyan-50 text-cyan-800 border-cyan-200/80 ring-1 ring-cyan-400/20",
    pill: "bg-cyan-100 text-cyan-800",
    iconBg: "bg-cyan-100 text-cyan-700",
    iconText: "text-cyan-700",
    cardActive: "border-cyan-400 bg-white shadow-sm ring-2 ring-cyan-200",
    dot: "bg-cyan-500",
    border: "border-cyan-200",
    bgLight: "bg-cyan-50/50",
  },
  exam_cell: {
    badge: "bg-rose-50 text-rose-800 border-rose-200/80 ring-1 ring-rose-400/20",
    pill: "bg-rose-100 text-rose-800",
    iconBg: "bg-rose-100 text-rose-700",
    iconText: "text-rose-700",
    cardActive: "border-rose-400 bg-white shadow-sm ring-2 ring-rose-200",
    dot: "bg-rose-500",
    border: "border-rose-200",
    bgLight: "bg-rose-50/50",
  },
};

const DEFAULT_ROLE_STYLE: RoleStyle = {
  badge: "bg-slate-100 text-slate-700 border-slate-200/80 ring-1 ring-slate-400/20",
  pill: "bg-slate-100 text-slate-700",
  iconBg: "bg-slate-100 text-slate-500",
  iconText: "text-slate-500",
  cardActive: "border-slate-400 bg-white shadow-sm ring-2 ring-slate-200",
  dot: "bg-slate-400",
  border: "border-slate-200",
  bgLight: "bg-slate-50/50",
};

export function getRoleStyle(roleKey?: string | null): RoleStyle {
  if (!roleKey) return DEFAULT_ROLE_STYLE;
  const key = roleKey.toLowerCase().trim();
  return ROLE_STYLES[key] ?? DEFAULT_ROLE_STYLE;
}

export function RoleBadge({
  roleKey,
  label,
  assignmentCount,
  showDot = true,
  className,
}: {
  roleKey?: string | null;
  label: string;
  assignmentCount?: number;
  showDot?: boolean;
  className?: string;
}) {
  const style = getRoleStyle(roleKey);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors shadow-2xs",
        style.badge,
        className,
      )}
      title={
        assignmentCount && assignmentCount > 1
          ? `${label} (${assignmentCount} scopes)`
          : label
      }
    >
      {showDot && (
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", style.dot)} aria-hidden="true" />
      )}
      <span className="font-semibold">{label}</span>
      {assignmentCount && assignmentCount > 1 ? (
        <span className="opacity-80 font-normal"> · {assignmentCount} scopes</span>
      ) : null}
    </span>
  );
}
