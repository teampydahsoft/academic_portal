export type StudentListRow = {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: string | null;
  photo: string | null;
  hasPhoto?: boolean;
  college: string;
  course: string;
  branch: string;
  year: number | null;
  semester?: number | null;
  batch: string;
  section: string;
  attendance: number;
  risk: string;
  status: string;
};

export type AttendanceSemesterOption = {
  key: string;
  yearOfStudy: number;
  semesterNumber: number;
  yearSemLabel: string;
  startDate: string | null;
  endDate: string | null;
  hasDates: boolean;
  isCurrent: boolean;
  label: string;
};

export type StudentComplaint = {
  id: number;
  riskType: string;
  riskReason: string | null;
  initialNotes?: string | null;
  severity: string;
  status: string;
  openedAt: string;
  openedBy?: number | null;
  openedByName?: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  interventions: Array<{
    id: number;
    actionType: string;
    notes: string | null;
    outcome: string | null;
    followUpDate: string | null;
    actionAt: string;
    actionByName: string | null;
  }>;
  events: Array<{
    id: number;
    eventType: string;
    oldStatus: string | null;
    newStatus: string | null;
    notes: string | null;
    createdAt: string;
    actorName: string | null;
  }>;
};

export type StudentDetail = {
  id: string;
  name: string;
  admissionNo: string;
  rollNo: string | null;
  photo: string | null;
  status: string;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
  year: number | null;
  semester: number | null;
  section: string | null;
  admissionType: string | null;
  admissionDate: string | null;
  previousCollege: string | null;
  scholarStatus: string | null;
  feeStatus: string | null;
  registrationStatus: string | null;
  certificatesStatus: string | null;
  dob: string | null;
  gender: string | null;
  email: string | null;
  mobile: string | null;
  fatherName: string | null;
  parentMobile1: string | null;
  parentMobile2: string | null;
  preferredMobile: string | null;
  address: string | null;
  cityVillage: string | null;
  mandal: string | null;
  district: string | null;
  attendance: number;
  present: number;
  absent: number;
  workingDays: number;
  risk: string;
  attendancePeriod?: {
    source: "semester" | "fallback_90_days";
    startDate: string | null;
    endDate: string | null;
    attendanceEndDate?: string | null;
    yearOfStudy?: number | null;
    semesterNumber?: number | null;
    yearSemLabel?: string | null;
    semesterId: number | null;
    label: string;
  };
  attendanceSemesters?: AttendanceSemesterOption[];
  complaints?: StudentComplaint[];
};

