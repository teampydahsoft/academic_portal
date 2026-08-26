export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  academicDb: {
    host: process.env.ACADEMIC_DB_HOST ?? "127.0.0.1",
    port: Number(process.env.ACADEMIC_DB_PORT ?? 3306),
    user: process.env.ACADEMIC_DB_USER ?? "academic_app",
    password: process.env.ACADEMIC_DB_PASSWORD ?? "",
    database: process.env.ACADEMIC_DB_NAME ?? "academic_portal",
    ssl: (process.env.ACADEMIC_DB_SSL ?? "false") === "true",
  },
  studentDb: {
    host: process.env.STUDENT_DB_HOST ?? "",
    port: Number(process.env.STUDENT_DB_PORT ?? 3306),
    user: process.env.STUDENT_DB_USER ?? "",
    password: process.env.STUDENT_DB_PASSWORD ?? "",
    database: process.env.STUDENT_DB_NAME ?? "student_database",
    ssl: (process.env.STUDENT_DB_SSL ?? "true") === "true",
  },
  examDb: {
    host: process.env.EXAM_DB_HOST ?? "",
    port: Number(process.env.EXAM_DB_PORT ?? 3306),
    user: process.env.EXAM_DB_USER ?? "",
    password: process.env.EXAM_DB_PASSWORD ?? "",
    database: process.env.EXAM_DB_NAME ?? "examination_portal",
    ssl: (process.env.EXAM_DB_SSL ?? "true") === "true",
  },
  hrmsMongoUrl: process.env.HRMS_MONGO_URL ?? "",
  /**
   * Student DB Attendance Calendar fetches public holidays from Nager.Date.
   * Academic Portal reuses that same live API — never persisted here.
   */
  nagerDate: {
    baseUrl: process.env.NAGER_DATE_BASE_URL ?? "https://date.nager.at/api/v3",
    countryCode: process.env.NAGER_COUNTRY_CODE ?? "IN",
  },
  /**
   * Session cookie settings. Tokens are opaque random values;
   * only SHA-256 hashes are stored in academic_portal.ap_sessions.
   * HRMS passwords are verified in place and never copied into AP.
   */
  auth: {
    cookieName: process.env.AP_SESSION_COOKIE ?? "ap_sid",
    /** Absolute session lifetime in hours. */
    sessionTtlHours: Number(process.env.AP_SESSION_TTL_HOURS ?? 12),
    secureCookies:
      (process.env.AP_SESSION_SECURE ??
        (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
  },
  /**
   * Bootstrap Super Admin password for local/dev seed only.
   * Production must set AP_SUPERADMIN_PASSWORD (or AP_BOOTSTRAP_SUPERADMIN_PASSWORD).
   * Never logged.
   */
  superAdminBootstrap: {
    password:
      process.env.AP_SUPERADMIN_PASSWORD?.trim() ||
      process.env.AP_BOOTSTRAP_SUPERADMIN_PASSWORD?.trim() ||
      (process.env.NODE_ENV === "production" ? "" : "super admin 123"),
  },
};
