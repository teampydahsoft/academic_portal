export type ResultStudent = {
  id: number | null;
  rollNumber: string | null;
  admissionNo: string | null;
  name: string | null;
  college: string | null;
  course: string | null;
  branch: string | null;
  batch: string | null;
};

export type ResultUpload = {
  id: number;
  fileName: string | null;
  uploadedBy: string | null;
  createdAt: string | null;
  rowCount: number | null;
  studentCount: number | null;
};

export type ResultRow = {
  id: number;
  examId: number;
  examName: string | null;
  examType: string | null;
  examStatus: string | null;
  examCollege: string | null;
  examCourse: string | null;
  examBranch: string | null;
  examBatch: string | null;
  studentRollNumber: string;
  studentName: string | null;
  student: ResultStudent | null;
  subjectCode: string;
  subjectName: string | null;
  subjectId: number | null;
  subjectType: string | null;
  inExamSubjects: boolean;
  grade: string;
  gradePoints: number | null;
  credits: number;
  passed: boolean;
  result: "Pass" | "Fail";
  yearOfStudy: number;
  semester: number;
  attemptNumber: number;
  uploadId: number | null;
  upload: ResultUpload | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ResultSummary = {
  totalRows: number;
  uniqueStudents: number;
  passed: number;
  failed: number;
  passPercentage: number;
  gradeDistribution: { grade: string; count: number }[];
};

export type ResultsListResponse = {
  readOnly: true;
  source: Record<string, string>;
  count: number;
  total: number;
  summary: ResultSummary | null;
  data: ResultRow[];
};

export type ResultOptions = {
  readOnly: true;
  source: string;
  exams: {
    id: number;
    name: string;
    type: string | null;
    status: string | null;
    course: string | null;
    branch: string | null;
    batch: string | null;
  }[];
  examTypes: string[];
  resultStatuses: { value: string; label: string }[];
};

export type ExamResultsResponse = {
  readOnly: true;
  source: Record<string, string>;
  exam: {
    id: number;
    name: string;
    type: string | null;
    status: string | null;
    college: string | null;
    course: string | null;
    branch: string | null;
    batch: string | null;
    yearOfStudy: number | null;
    semester: number | null;
    publishedAt: string | null;
  };
  resultCount: number;
  summary: ResultSummary | null;
  uploads: ResultUpload[];
  data: ResultRow[];
};

export type StudentResultsResponse = {
  readOnly: true;
  source: Record<string, string>;
  student: ResultStudent;
  resultCount: number;
  summary: ResultSummary | null;
  examinations: {
    examId: number;
    examName: string | null;
    examType: string | null;
    examStatus: string | null;
    yearOfStudy: number | null;
    semester: number | null;
    subjects: ResultRow[];
  }[];
  data: ResultRow[];
};

export function formatPoints(value: number | null | undefined): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function formatCredits(value: number | null | undefined): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
