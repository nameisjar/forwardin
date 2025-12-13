/*
  Warnings:

  - A unique constraint covering the columns `[wa_message_id]` on the table `OutgoingMessage` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "OutgoingMessage" ADD COLUMN     "wa_message_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OutgoingMessage_wa_message_id_key" ON "OutgoingMessage"("wa_message_id");
