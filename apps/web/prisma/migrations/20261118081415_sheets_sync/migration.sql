-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "broadcastType" TEXT,
ADD COLUMN     "details" TEXT,
ADD COLUMN     "workType" TEXT;

-- CreateTable
CREATE TABLE "SheetOutbox" (
    "id" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "ref" TEXT,
    "op" JSONB NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SheetOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SheetOutbox_sentAt_sheet_idx" ON "SheetOutbox"("sentAt", "sheet");

-- CreateIndex
CREATE INDEX "SheetOutbox_ref_idx" ON "SheetOutbox"("ref");
