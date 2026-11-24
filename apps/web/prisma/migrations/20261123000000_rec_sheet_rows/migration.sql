-- CreateTable
CREATE TABLE "RecSheetRow" (
    "id" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "cells" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecSheetRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecSheetRow_tab_row_key" ON "RecSheetRow"("tab", "row");
