export type ExaminationListItem = {
  id: number;
  name: string;
  type: string | null;
  status: string | null;
  regulationId: number | null;
  regulationCode: string | null;
  regulationName: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
  yearOfStudy: number | null;
  semester: number | null;
  examinationStartDate: string | null;
  examinationEndDate: string | null;
  applicationStartDate: string | null;
  applicationEndDate: string | null;
  publishedAt: string | null;
  packageFee: number | null;
  instructions: string | null;
  scopeCount: number;
  subjectCount: number;
  applicationCount: number;
};

export type ExamScope = {
  id: number;
  examId: number;
  college: string | null;
  course: string | null;
  branch: string | null;
  branchId: number | null;
  batch: string | null;
  yearOfStudy: number | null;
  semester: number | null;
  section: string | null;
};

export type ExamPaper = {
  id: number;
  examId: number;
  subjectId: number;
  subjectCode: string | null;
  subjectName: string | null;
  type: string | null;
  examDate: string | null;
  fee: number | null;
  branch: string | null;
  session: string | null;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
  section: string | null;
};

export type ExamApplicationSubject = {
  subjectId: number;
  subjectCode: string | null;
  subjectName: string | null;
  type: string | null;
  examDate: string | null;
  fee: number | null;
};

export type ExamApplication = {
  id: number;
  examId: number;
  examType: string | null;
  studentRollNumber: string | null;
  studentName: string | null;
  studentBranch: string | null;
  studentSection: string | null;
  submittedAt: string | null;
  selectedSubjectIds: number[];
  selectedSubjects: ExamApplicationSubject[];
  feeRecordId: number | null;
  feeStatus: string | null;
  totalAmount: number | null;
  baseFee: number | null;
  lateFee: number | null;
  exam?: ExaminationListItem | null;
};

export type ExaminationListResponse = {
  readOnly: true;
  source: Record<string, string>;
  count: number;
  data: ExaminationListItem[];
};

export type ExaminationDetailResponse = {
  readOnly: true;
  source: Record<string, string>;
  exam: ExaminationListItem;
  scopes: ExamScope[];
  subjects: ExamPaper[];
  applications: ExamApplication[];
};

export type ExaminationOptions = {
  source: string;
  regulations: { id: number; code: string; name: string; status: string | null }[];
  statuses: string[];
  types: string[];
};

export type StudentExaminationsResponse = {
  readOnly: true;
  source: Record<string, string>;
  student: {
    id: number;
    name: string | null;
    admissionNo: string;
    rollNumber: string | null;
    college: string | null;
    course: string | null;
    branch: string | null;
    batch: string | null;
    year: number | null;
    semester: number | null;
    section: string | null;
  };
  eligibleExams: ExaminationListItem[];
  applications: ExamApplication[];
};

export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function formatFee(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
