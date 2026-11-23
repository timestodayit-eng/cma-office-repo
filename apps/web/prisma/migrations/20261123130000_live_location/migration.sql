-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "inAcc" DOUBLE PRECISION,
ADD COLUMN     "inLat" DOUBLE PRECISION,
ADD COLUMN     "inLng" DOUBLE PRECISION,
ADD COLUMN     "outAcc" DOUBLE PRECISION,
ADD COLUMN     "outLat" DOUBLE PRECISION,
ADD COLUMN     "outLng" DOUBLE PRECISION,
ADD COLUMN     "selfieIn" TEXT,
ADD COLUMN     "selfieOut" TEXT;

-- CreateTable
CREATE TABLE "LocationPoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "acc" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationStatus" (
    "userId" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "sharing" BOOLEAN NOT NULL DEFAULT false,
    "lastAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "acc" DOUBLE PRECISION,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationStatus_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "LocationPoint_userId_at_idx" ON "LocationPoint"("userId", "at");

-- CreateIndex
CREATE INDEX "LocationPoint_at_idx" ON "LocationPoint"("at");

-- AddForeignKey
ALTER TABLE "LocationPoint" ADD CONSTRAINT "LocationPoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationStatus" ADD CONSTRAINT "LocationStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
