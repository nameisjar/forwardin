-- AlterTable
ALTER TABLE "IncomingMessage" ADD COLUMN     "is_read" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "idx_incoming_message_device_read" ON "IncomingMessage"("device_id", "is_read");
