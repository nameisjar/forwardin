/*
  Warnings:

  - You are about to drop the column `deviceId` on the `IncomingMessage` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `Message` table. All the data in the column will be lost.
  - You are about to drop the column `deviceId` on the `OutgoingMessage` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "IncomingMessage" DROP CONSTRAINT "IncomingMessage_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "OutgoingMessage" DROP CONSTRAINT "OutgoingMessage_deviceId_fkey";

-- AlterTable
ALTER TABLE "Broadcast" ALTER COLUMN "message" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "IncomingMessage" DROP COLUMN "deviceId";

-- AlterTable
ALTER TABLE "Message" DROP COLUMN "deviceId";

-- AlterTable
ALTER TABLE "OutgoingMessage" DROP COLUMN "deviceId";

-- CreateTable
CREATE TABLE "CourseReminder" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "courseName" TEXT NOT NULL,
    "lesson" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseReminder_pkey" PRIMARY KEY ("pkId")
);

-- CreateTable
CREATE TABLE "CourseFeedback" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "courseName" TEXT NOT NULL,
    "lesson" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseFeedback_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseReminder_id_key" ON "CourseReminder"("id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseFeedback_id_key" ON "CourseFeedback"("id");
