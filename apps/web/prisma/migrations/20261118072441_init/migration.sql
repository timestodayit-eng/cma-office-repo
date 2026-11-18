-- CreateEnum
CREATE TYPE "Level" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "Access" AS ENUM ('OFF', 'VIEW', 'EDIT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('WAITING', 'TODO', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('REVIEW', 'QC', 'MODIFY', 'APPROVAL', 'RAW_FILE', 'CUSTOM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "level" "Level" NOT NULL DEFAULT 'STAFF',
    "department" TEXT,
    "designation" TEXT,
    "jdCode" TEXT,
    "whatsapp" TEXT,
    "whatsappOn" BOOLEAN NOT NULL DEFAULT true,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModulePermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "access" "Access" NOT NULL DEFAULT 'OFF',

    CONSTRAINT "ModulePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "companies" TEXT[],
    "contentTypes" TEXT[],

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short" TEXT NOT NULL,
    "hotlines" TEXT[],
    "sheetTab" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRole" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "role" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CompanyRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "interviewDate" DATE NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Upcoming',
    "marketingPlanUsd" DECIMAL(12,2),
    "totalCostUsd" DECIMAL(12,2),
    "totalCostBdt" DECIMAL(14,2),
    "rateBdt" DECIMAL(8,2),
    "passports" INTEGER,
    "leads" INTEGER,
    "topUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sheetRef" TEXT,
    "bridgeWithId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT,
    "companyId" TEXT,
    "chain" TEXT,
    "stepKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "pool" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT,
    "checkerId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'WAITING',
    "startDate" DATE,
    "dueDate" DATE,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "scriptLink" TEXT,
    "driveLink" TEXT,
    "videoLink" TEXT,
    "postLink" TEXT,
    "handoverNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "taskId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "whatsapp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogRow" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sn" INTEGER,
    "title" TEXT,
    "deadline" TEXT,
    "priority" TEXT,
    "company" TEXT,
    "mainCategory" TEXT,
    "contentType" TEXT,
    "scriptWriter" TEXT,
    "scriptLink" TEXT,
    "presenter" TEXT,
    "cinematographer" TEXT,
    "videoEditor" TEXT,
    "status" TEXT,
    "thumbnail" TEXT,
    "rawFile" TEXT,
    "finalOutput" TEXT,
    "comments" TEXT,
    "uploadFacebook" TEXT,
    "uploadYoutube" TEXT,
    "uploadTiktok" TEXT,
    "platformFacebook" TEXT,
    "platformYoutube" TEXT,
    "platformTiktok" TEXT,
    "finalComments" TEXT,
    "rowIndex" INTEGER NOT NULL DEFAULT 0,
    "taskId" TEXT,
    "sheetRef" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastSlot" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "callDate" DATE NOT NULL,
    "missedSent" BOOLEAN NOT NULL DEFAULT false,
    "missedAt" TIMESTAMP(3),
    "receivedSent" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "smsSent" BOOLEAN NOT NULL DEFAULT false,
    "sentById" TEXT,

    CONSTRAINT "BroadcastSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ModulePermission_userId_module_key" ON "ModulePermission"("userId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "Responsibility_userId_key_key" ON "Responsibility"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_short_key" ON "Company"("short");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRole_companyId_role_userId_key" ON "CompanyRole"("companyId", "role", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_sheetRef_key" ON "Interview"("sheetRef");

-- CreateIndex
CREATE INDEX "Interview_interviewDate_idx" ON "Interview"("interviewDate");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_interviewId_idx" ON "Task"("interviewId");

-- CreateIndex
CREATE INDEX "Request_toId_status_idx" ON "Request"("toId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "LogRow_sheetRef_key" ON "LogRow"("sheetRef");

-- CreateIndex
CREATE INDEX "LogRow_date_idx" ON "LogRow"("date");

-- CreateIndex
CREATE INDEX "LogRow_status_idx" ON "LogRow"("status");

-- CreateIndex
CREATE INDEX "BroadcastSlot_callDate_idx" ON "BroadcastSlot"("callDate");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastSlot_interviewId_slot_key" ON "BroadcastSlot"("interviewId", "slot");

-- AddForeignKey
ALTER TABLE "ModulePermission" ADD CONSTRAINT "ModulePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRole" ADD CONSTRAINT "CompanyRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRole" ADD CONSTRAINT "CompanyRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastSlot" ADD CONSTRAINT "BroadcastSlot_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
