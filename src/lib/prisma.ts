import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// ローカル開発では file:./dev.db（authToken なし）、
// 本番(Turso)では TURSO_DATABASE_URL=libsql://... と TURSO_AUTH_TOKEN を使う。
// 空文字も未設定扱いにする（?? は "" を素通しし libSQL が壊れる）。
// ローカルで .env.local に TURSO_DATABASE_URL="" を置けば dev.db に切替できる。
const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL || "file:./dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
