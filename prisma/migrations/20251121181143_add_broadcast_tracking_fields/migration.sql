-- AlterTable
ALTER TABLE "OutgoingMessage" ADD COLUMN     "broadcastId" INTEGER,
ADD COLUMN     "isGroup" BOOLEAN DEFAULT false;
