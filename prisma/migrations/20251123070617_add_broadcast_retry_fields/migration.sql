-- SQLBook: Code
-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN "last_attempt_at" TIMESTAMP(3),
ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sent_count" INTEGER DEFAULT 0,
ADD COLUMN "failed_count" INTEGER DEFAULT 0,
ADD COLUMN "last_error" TEXT;