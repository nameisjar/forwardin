/*
  Warnings:

  - You are about to drop the column `initial_password` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "initial_password";
