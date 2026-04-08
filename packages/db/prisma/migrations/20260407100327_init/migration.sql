-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('MANUAL', 'SHEETS');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('PENDING', 'QUEUED', 'CHECKING', 'DONE', 'ERROR');

-- CreateEnum
CREATE TYPE "SheetsTaskStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "manualChecking" BOOLEAN NOT NULL DEFAULT false,
    "sheetsChecking" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sheetsTaskId" TEXT,
    "source" "LinkSource" NOT NULL,
    "donorUrl" TEXT NOT NULL,
    "acceptorHost" TEXT NOT NULL,
    "acceptorRaw" TEXT NOT NULL,
    "status" "LinkStatus" NOT NULL DEFAULT 'PENDING',
    "donorStatusCode" INTEGER,
    "donorFinalUrl" TEXT,
    "donorRedirectChain" JSONB,
    "donorIndexable" BOOLEAN,
    "donorMetaRobots" TEXT,
    "donorXRobotsTag" TEXT,
    "donorCanonical" TEXT,
    "canonicalMatches" BOOLEAN,
    "linkFound" BOOLEAN,
    "occurrences" JSONB,
    "occurrencesCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "checkDurationMs" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCooldownAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetsTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT,
    "donorColumn" TEXT NOT NULL,
    "acceptorColumn" TEXT NOT NULL,
    "resultStartCol" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "dataStartRow" INTEGER NOT NULL DEFAULT 2,
    "scheduleCron" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "status" "SheetsTaskStatus" NOT NULL DEFAULT 'IDLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetsTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Link_projectId_source_idx" ON "Link"("projectId", "source");

-- CreateIndex
CREATE INDEX "Link_projectId_status_idx" ON "Link"("projectId", "status");

-- CreateIndex
CREATE INDEX "Link_sheetsTaskId_idx" ON "Link"("sheetsTaskId");

-- CreateIndex
CREATE INDEX "Link_status_idx" ON "Link"("status");

-- CreateIndex
CREATE INDEX "SheetsTask_projectId_idx" ON "SheetsTask"("projectId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_sheetsTaskId_fkey" FOREIGN KEY ("sheetsTaskId") REFERENCES "SheetsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetsTask" ADD CONSTRAINT "SheetsTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
