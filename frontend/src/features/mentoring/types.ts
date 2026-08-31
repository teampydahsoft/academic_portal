export type RiskLevel = "High" | "Medium" | "Low";

export type RiskCaseStatus = "open" | "monitoring" | "resolved" | "escalated";

export type InterventionType =
  | "counselling"
  | "parent_communication"
  | "academic_support"
  | "attendance_follow_up"
  | "other";

export type MentoringDashboardSummary = {
  totalMentees: number;
  highRisk: number;
  mediumRisk: number;
  openCases: number;
  followUpsDue: number;
  escalated: number;
};

export type MentoringStudentRow = {
  id: string;
  name: string;
  rollNo: string | null;
  admissionNo: string;
  college: string;
  course: string;
  branch: string;
  year: number | null;
  semester: number | null;
  section: string;
  attendance: number;
  risk: RiskLevel;
  riskReason: string;
  mentor: {
    assignmentId: number;
    staffLinkId: number;
    name: string;
  } | null;
  activeCase: {
    id: number;
    status: RiskCaseStatus;
    severity: string;
    openedAt: string;
    escalated: boolean;
  } | null;
};

export type MentoringDashboardResponse = {
  summary: MentoringDashboardSummary;
  data: MentoringStudentRow[];
  total: number;
  limit: number;
  offset: number;
  truncated?: boolean;
};

export type SubjectAttendanceRow = {
  subjectCode: string | null;
  subjectName: string;
  attendance: number;
  present: number;
  absent: number;
  risk: RiskLevel;
};

export type MentoringStudentDetail = {
  student: {
    id: string;
    name: string;
    rollNo: string | null;
    admissionNo: string;
    college: string | null;
    course: string | null;
    branch: string | null;
    year: number | null;
    semester: number | null;
    section: string | null;
    status: string;
  };
  attendance: {
    overall: number;
    present: number;
    absent: number;
    workingDays: number;
    risk: RiskLevel;
    riskReason: string;
    period: {
      label: string;
      yearOfStudy?: number | null;
      semesterNumber?: number | null;
    } | null;
    subjects: SubjectAttendanceRow[];
  };
  mentor: {
    assignmentId: number;
    staffLinkId: number;
    name: string;
    academicYearLabel: string;
  } | null;
  mentorAssignments: Array<{
    assignmentId: number;
    studentDbId: number;
    facultyStaffLinkId: number;
    mentorName: string;
    academicYearLabel: string;
    createdAt: string;
  }>;
  activeCase: {
    id: number;
    riskType: string;
    riskReason: string | null;
    severity: string;
    status: RiskCaseStatus;
    openedAt: string;
    escalatedAt: string | null;
    resolvedAt: string | null;
  } | null;
  caseHistory: Array<{
    id: number;
    status: RiskCaseStatus;
    severity: string;
    openedAt: string;
    resolvedAt: string | null;
  }>;
  interventions: Array<{
    id: number;
    actionType: InterventionType;
    notes: string | null;
    outcome: string | null;
    followUpDate: string | null;
    actionAt: string;
    actionByName: string | null;
  }>;
  caseEvents: Array<{
    id: number;
    eventType: string;
    oldStatus: string | null;
    newStatus: string | null;
    notes: string | null;
    createdAt: string;
    actorName: string | null;
  }>;
  permissions: {
    canAssign: boolean;
    canIntervene: boolean;
    canManageCase: boolean;
    canEscalate: boolean;
  };
};

export type StaffSearchResult = {
  staffLinkId: number;
  name: string;
  hrmsEmployeeId: string;
  department: string | null;
  employeeCode: string | null;
};

export type MentoringListFilters = {
  risk: RiskLevel | "all";
  caseStatus: RiskCaseStatus | "none" | "all";
  mentorStaffLinkId: number | "all";
  onlyAtRisk: boolean;
};
