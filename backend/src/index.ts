import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { loadSession, requireAuth, type AuthedRequest } from "./middleware/auth.middleware.js";
import { ensureAuthSchema } from "./services/auth.service.js";
import { healthRouter } from "./routes/health.route.js";
import { authRouter, sendCurrentUser } from "./routes/auth.route.js";
import { commandCenterRouter } from "./routes/command-center.route.js";
import { studentsRouter } from "./routes/students.route.js";
import { timetablesRouter } from "./routes/timetables.route.js";
import { workloadRouter } from "./routes/workload.route.js";
import { attendanceRouter } from "./routes/attendance.route.js";
import { semesterDatesRouter } from "./routes/semester-dates.route.js";
import { catalogRouter } from "./routes/catalog.route.js";
import { timingRouter } from "./routes/timing.route.js";
import { classSessionsRouter } from "./routes/class-sessions.route.js";
import { academicDatesRouter } from "./routes/academic-dates.route.js";
import { facultyRouter } from "./routes/faculty.route.js";
import { settingsRouter } from "./routes/settings.route.js";
import { examinationsRouter } from "./routes/examinations.route.js";
import { resultsRouter } from "./routes/results.route.js";
import { usersRouter } from "./routes/users.route.js";
import { rolesRouter } from "./routes/roles.route.js";
import { permissionsRouter } from "./routes/permissions.route.js";
import { myTimetableRouter } from "./routes/my-timetable.route.js";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(loadSession);

app.get("/", (_req, res) => {
  res.json({
    name: "Pydah Academic Portal API",
    status: "ok",
  });
});

// Explicit public endpoints (also reachable without requireAuth)
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);

// Everything under /api/* requires an authenticated AP session by default
app.use("/api", requireAuth);
app.get("/api/me", (req, res) => sendCurrentUser(req as AuthedRequest, res));


app.use("/api/command-center", commandCenterRouter);
app.use("/api/students", studentsRouter);
app.use("/api/semester-dates", semesterDatesRouter);
app.use("/api/timetables", timetablesRouter);
app.use("/api/timings", timingRouter);
app.use("/api/class-sessions", classSessionsRouter);
app.use("/api/academic-dates", academicDatesRouter);
app.use("/api/my-timetable", myTimetableRouter);
app.use("/api/workload", workloadRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/faculty", facultyRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/examinations", examinationsRouter);
app.use("/api/results", resultsRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/permissions", permissionsRouter);

app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = Number(err.status) || 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({
        message: err.message || "Request failed",
      });
      return;
    }
    console.error(err);
    res.status(500).json({
      message: err.message || "Internal server error",
    });
  },
);

if (env.nodeEnv === "production" && !env.auth.secureCookies) {
  // IP/HTTP Lightsail deploys (no TLS yet) must set AP_ALLOW_INSECURE_HTTP=true.
  // Prefer HTTPS + AP_SESSION_SECURE=true as soon as a domain/certificate is available.
  if (process.env.AP_ALLOW_INSECURE_HTTP === "true") {
    console.warn(
      "WARNING: production with AP_SESSION_SECURE=false (AP_ALLOW_INSECURE_HTTP=true). Use HTTPS when possible.",
    );
  } else {
    console.error(
      "Production requires AP_SESSION_SECURE=true when serving over HTTPS. Refusing to start.",
    );
    process.exit(1);
  }
}

ensureAuthSchema()
  .catch((error) => {
    console.error("Failed to ensure auth schema:", error);
  })
  .finally(() => {
    app.listen(env.port, () => {
      console.log(`Academic Portal API listening on http://localhost:${env.port}`);
    });
  });
