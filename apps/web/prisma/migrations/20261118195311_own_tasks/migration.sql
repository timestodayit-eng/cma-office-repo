-- CreateTable
CREATE TABLE "OwnTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnTask_userId_doneAt_idx" ON "OwnTask"("userId", "doneAt");

-- AddForeignKey
ALTER TABLE "OwnTask" ADD CONSTRAINT "OwnTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
