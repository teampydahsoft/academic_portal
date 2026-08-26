# Pydah Academic Portal

Monorepo layout:

- `frontend/` — Next.js + TypeScript + Tailwind UI
- `backend/` — Express + TypeScript + MySQL API

## Quick start

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open http://localhost:3000

## Scope

Only the 15 management-approved modules. Priority UX:

1. Timetable Planning
2. Staff Workload
3. Faculty Attendance Posting

Existing production databases are read-only. Writes go only to `academic_portal`.
