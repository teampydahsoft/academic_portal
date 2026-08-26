import "dotenv/config";
import { env } from "../config/env.js";
import { queryAcademic } from "../db/pools.js";
import type { RowDataPacket } from "mysql2";

const base = `http://127.0.0.1:${env.port}`;

async function req(
  path: string,
  init: RequestInit & { cookie?: string } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, setCookie, text };
}

function extractSid(setCookie: string[]) {
  const prefix = `${env.auth.cookieName}=`;
  for (const line of setCookie) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).split(";")[0];
    }
  }
  return null;
}

async function main() {
  console.log("=== Auth foundation security tests ===\n");

  const unauthStudents = await req("/api/students?limit=1");
  console.log("1. Unauthenticated /api/students", unauthStudents.status);
  if (unauthStudents.status !== 401) throw new Error("Expected 401 for students");

  const unauthPhoto = await req("/api/students/1/photo");
  console.log("2. Unauthenticated student photo", unauthPhoto.status);
  if (unauthPhoto.status !== 401) throw new Error("Expected 401 for photo");

  const unauthTimetable = await req("/api/timetables/draft", {
    method: "POST",
    body: JSON.stringify({}),
  });
  console.log("3. Unauthenticated timetable write", unauthTimetable.status);
  if (unauthTimetable.status !== 401) throw new Error("Expected 401 for timetable write");

  const unauthAttendance = await req("/api/attendance/sessions/1", {
    method: "POST",
    body: JSON.stringify({ students: [] }),
  });
  console.log("4. Unauthenticated attendance POST", unauthAttendance.status);
  if (unauthAttendance.status !== 401) throw new Error("Expected 401 for attendance");

  const unauthExams = await req("/api/examinations");
  console.log("5. Unauthenticated examinations", unauthExams.status);
  if (unauthExams.status !== 401) throw new Error("Expected 401 for examinations");

  const unauthResults = await req("/api/results");
  console.log("6. Unauthenticated results", unauthResults.status);
  if (unauthResults.status !== 401) throw new Error("Expected 401 for results");

  const health = await req("/api/health");
  console.log("7. Public health", health.status, health.json);
  if (health.status !== 200) throw new Error("Health should be public");

  const badLogin = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: "nobody@example.com", password: "wrong" }),
  });
  console.log("8. Bad login", badLogin.status);
  if (badLogin.status !== 401) throw new Error("Expected 401 for bad login");

  const testUser = process.env.AP_TEST_USER?.trim();
  const testPassword = process.env.AP_TEST_PASSWORD ?? "";
  if (!testUser || !testPassword) {
    console.log(
      "\n9-12. Skipping live login tests (set AP_TEST_USER + AP_TEST_PASSWORD to exercise full flow)",
    );
  } else {
    const login = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier: testUser, password: testPassword }),
    });
    console.log("9. Login", login.status, (login.json as { user?: { email?: string } })?.user?.email);
    if (login.status !== 200) throw new Error("Login failed");
    const sid = extractSid(login.setCookie);
    if (!sid) throw new Error("Session cookie not set");

    const me = await req("/api/auth/me", { cookie: `${env.auth.cookieName}=${sid}` });
    console.log("10. /api/auth/me", me.status, me.json);
    if (me.status !== 200) throw new Error("/me failed");

    const students = await req("/api/students?limit=1", {
      cookie: `${env.auth.cookieName}=${sid}`,
    });
    console.log("11. Authenticated students", students.status);
    if (students.status !== 200) throw new Error("Authenticated students failed");

    // password_hash must remain null on ap_users
    const hashes = await queryAcademic<RowDataPacket[]>(
      `SELECT id, username, password_hash IS NULL AS hash_null FROM ap_users WHERE email = ? OR username = ?`,
      [testUser.toLowerCase(), testUser.toLowerCase()],
    );
    console.log("12. AP password_hash null?", hashes);
    if (!hashes.length || Number(hashes[0].hash_null) !== 1) {
      throw new Error("password_hash must remain NULL");
    }

    const logout = await req("/api/auth/logout", {
      method: "POST",
      cookie: `${env.auth.cookieName}=${sid}`,
    });
    console.log("13. Logout", logout.status);
    if (logout.status !== 200) throw new Error("Logout failed");

    const after = await req("/api/students?limit=1", {
      cookie: `${env.auth.cookieName}=${sid}`,
    });
    console.log("14. After logout students", after.status);
    if (after.status !== 401) throw new Error("Session should be invalid after logout");
  }

  console.log("\nOK — auth foundation checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
