-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "demo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overtimeHours" DECIMAL(6,1) NOT NULL DEFAULT 0;
