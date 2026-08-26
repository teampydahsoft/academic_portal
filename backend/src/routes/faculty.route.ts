import { Router } from "express";
import type { AuthedRequest } from "../middleware/auth.middleware.js";
import { allowedCollegeNames } from "../authz/academic-entity-scope.js";
import {
  getAuthz,
  requirePermission,
  statusFromAuthzError,
} from "../authz/require-permission.js";
import {
  getDepartmentDetail,
  getFacultyDetail,
  listDepartmentsWithFaculty,
  listFaculty,
} from "../services/faculty.service.js";

export const facultyRouter = Router();

function str(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "" || value === "all") return undefined;
  return value;
}

function num(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (value === "" || value === "all") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function scopedCollegeNames(req: AuthedRequest): Promise<string[] | undefined> {
  const names = await allowedCollegeNames(getAuthz(req));
  return names == null ? undefined : names;
}

function collegeInScope(
  facultyCollege: string | null | undefined,
  allowed: string[] | undefined,
): boolean {
  if (allowed == null) return true;
  const college = String(facultyCollege ?? "")
    .trim()
    .toLowerCase();
  if (!college || college === "—") return false;
  return allowed.some((n) => n.toLowerCase() === college);
}

facultyRouter.get("/", requirePermission("faculty.view"), async (req: AuthedRequest, res, next) => {
  try {
    const collegeNames = await scopedCollegeNames(req);
    res.json(
      await listFaculty({
        division: str(req.query.division),
        department: str(req.query.department),
        search: str(req.query.search),
        linkStatus: (str(req.query.linkStatus) ?? "all") as "linked" | "unlinked" | "all",
        collegeNames,
        page: num(req.query.page),
        pageSize: num(req.query.pageSize),
      }),
    );
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});

facultyRouter.get(
  "/departments",
  requirePermission("faculty.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const collegeNames = await scopedCollegeNames(req);
      const payload = await listDepartmentsWithFaculty();
      if (!collegeNames) {
        res.json(payload);
        return;
      }
      // Departments list is derived from faculty rows; re-filter via listFaculty collegeNames.
      const scoped = await listFaculty({ collegeNames, page: 1, pageSize: 10000 });
      const deptMap = new Map<string, number>();
      for (const emp of scoped.data) {
        const division = emp.division === "—" ? "Unassigned Division" : emp.division;
        const dept = emp.department === "—" ? "Unassigned Department" : emp.department;
        const key = `${division}__${dept}`;
        deptMap.set(key, (deptMap.get(key) ?? 0) + 1);
      }
      const data = Array.from(deptMap.entries())
        .map(([key, facultyCount]) => {
          const [division, name] = key.split("__");
          return {
            id: encodeURIComponent(key),
            key,
            name,
            division,
            facultyCount,
          };
        })
        .sort((a, b) => {
          const byName = a.name.localeCompare(b.name);
          return byName !== 0 ? byName : a.division.localeCompare(b.division);
        });
      res.json({
        ...payload,
        data,
        kpis: {
          totalFaculty: scoped.pagination.total,
          linkedCount: scoped.kpis.linkedCount,
          unlinkedCount: scoped.kpis.unlinkedCount,
          departmentCount: data.length,
        },
      });
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

facultyRouter.get(
  "/departments/:name",
  requirePermission("faculty.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const detail = await getDepartmentDetail(decodeURIComponent(String(name)));
      const collegeNames = await scopedCollegeNames(req);
      if (collegeNames && detail && Array.isArray((detail as { faculty?: unknown }).faculty)) {
        const faculty = (detail as { faculty: Array<{ college?: string }> }).faculty.filter((f) =>
          collegeInScope(f.college, collegeNames),
        );
        res.json({ ...detail, faculty });
        return;
      }
      res.json(detail);
    } catch (error) {
      const status = statusFromAuthzError(error);
      if (status === 401 || status === 403) {
        res.status(status).json({ message: (error as Error).message || "Forbidden" });
        return;
      }
      next(error);
    }
  },
);

facultyRouter.get("/:hrmsId", requirePermission("faculty.view"), async (req: AuthedRequest, res, next) => {
  try {
    const hrmsId = Array.isArray(req.params.hrmsId) ? req.params.hrmsId[0] : req.params.hrmsId;
    const detail = await getFacultyDetail(String(hrmsId));
    if (!detail) {
      res.status(404).json({ message: "Faculty not found" });
      return;
    }
    const collegeNames = await scopedCollegeNames(req);
    if (!collegeInScope((detail as { college?: string }).college, collegeNames)) {
      res.status(403).json({ message: "Forbidden for this college scope" });
      return;
    }
    res.json(detail);
  } catch (error) {
    const status = statusFromAuthzError(error);
    if (status === 401 || status === 403) {
      res.status(status).json({ message: (error as Error).message || "Forbidden" });
      return;
    }
    next(error);
  }
});
