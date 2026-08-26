import mysql from "mysql2/promise";
import { MongoClient, type Db } from "mongodb";
import { env } from "../config/env.js";

type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
};

let academicPool: mysql.Pool | null = null;
let studentPool: mysql.Pool | null = null;
let examPool: mysql.Pool | null = null;
let mongoClient: MongoClient | null = null;
let hrmsDb: Db | null = null;

function createPool(config: DbConfig, connectionLimit = 5) {
  if (!config.host || !config.user) {
    return null;
  }

  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit,
    enableKeepAlive: true,
    // Keep MySQL DATE/DATETIME as strings so JS timezones cannot shift calendar days.
    dateStrings: true,
    ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

export function getAcademicPool() {
  if (!academicPool) {
    academicPool = createPool(env.academicDb, 10);
  }
  return academicPool;
}

export function getStudentPool() {
  if (!studentPool) {
    studentPool = createPool(env.studentDb, 8);
  }
  if (!studentPool) {
    throw new Error("Student database is not configured");
  }
  return studentPool;
}

export function getExamPool() {
  if (!examPool) {
    examPool = createPool(env.examDb, 5);
  }
  if (!examPool) {
    throw new Error("Examination database is not configured");
  }
  return examPool;
}

export async function getHrmsDb() {
  if (!env.hrmsMongoUrl) {
    throw new Error("HRMS Mongo URL is not configured");
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(env.hrmsMongoUrl);
    await mongoClient.connect();
    hrmsDb = mongoClient.db("hrms");
  }

  if (!hrmsDb) {
    throw new Error("HRMS database connection failed");
  }

  return hrmsDb;
}

export async function queryStudent<T = mysql.RowDataPacket[]>(
  sql: string,
  params: unknown[] = [],
) {
  const [rows] = await getStudentPool().query(sql, params);
  return rows as T;
}

export async function executeStudent(sql: string, params: unknown[] = []) {
  const [result] = await getStudentPool().execute(sql, params);
  return result as mysql.ResultSetHeader;
}

export async function queryExam<T = mysql.RowDataPacket[]>(
  sql: string,
  params: unknown[] = [],
) {
  const [rows] = await getExamPool().query(sql, params);
  return rows as T;
}

export async function queryAcademic<T = mysql.RowDataPacket[]>(
  sql: string,
  params: unknown[] = [],
) {
  const pool = getAcademicPool();
  if (!pool) {
    throw new Error("Academic Portal database is not configured");
  }
  const [rows] = await pool.query(sql, params);
  return rows as T;
}

export async function executeAcademic(sql: string, params: unknown[] = []) {
  const pool = getAcademicPool();
  if (!pool) {
    throw new Error("Academic Portal database is not configured");
  }
  const [result] = await pool.execute(sql, params);
  return result as mysql.ResultSetHeader;
}

export async function withAcademicTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
) {
  const pool = getAcademicPool();
  if (!pool) {
    throw new Error("Academic Portal database is not configured");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
