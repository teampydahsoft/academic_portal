export type TimetablePeriod =
  | {
      kind: "class";
      entryId: number;
      startTime: string;
      endTime: string;
      slotLabel: string | null;
      minutes: number;
      entryType: string;
      subjectCode: string | null;
      subjectName: string | null;
      section: string | null;
      batch: string;
      year: number | null;
      semester: number | null;
      academicYear: string;
      collegeId: number;
      courseId: number;
      branchId: number;
      collegeName: string | null;
      courseName: string | null;
      branchName: string | null;
      roomLabel: string | null;
    }
  | {
      kind: "free";
      startTime: string;
      endTime: string;
      slotLabel: string | null;
    };

export type MyTimetableDay = {
  dayOfWeek: string;
  dayLabel: string;
  classCount: number;
  periods: TimetablePeriod[];
};

export type MyTimetableResponse = {
  linked: boolean;
  reason: "no_hrms_link" | "no_staff_link" | "not_found" | null;
  message: string | null;
  faculty: {
    id: string;
    staffLinkId: number;
    hrmsEmployeeId: string;
    name: string;
    code: string;
    department: string;
  } | null;
  summary: {
    periodsThisWeek: number;
    theory: number;
    lab: number;
    hoursPerWeek: number;
    subjects: number;
    sections: number;
  } | null;
  weekDays: MyTimetableDay[];
  source: string | null;
  published: boolean;
};
