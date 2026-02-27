-- AlterTable
ALTER TABLE "IncomingMessage" ADD COLUMN     "device_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_incoming_message_device" ON "IncomingMessage"("device_id");

-- AddForeignKey
ALTER TABLE "IncomingMessage" ADD CONSTRAINT "IncomingMessage_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
