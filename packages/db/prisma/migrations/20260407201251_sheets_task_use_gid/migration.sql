/*
  Warnings:

  - You are about to drop the column `sheetName` on the `SheetsTask` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SheetsTask" DROP COLUMN "sheetName",
ADD COLUMN     "sheetGid" INTEGER NOT NULL DEFAULT 0;
