-- AlterTable
ALTER TABLE "IncomingMessage" ADD COLUMN     "deviceId" INTEGER;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deviceId" INTEGER;

-- AlterTable
ALTER TABLE "OutgoingMessage" ADD COLUMN     "deviceId" INTEGER;

-- CreateTable
CREATE TABLE "Notification" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "userId" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_id_key" ON "Notification"("id");

-- AddForeignKey
ALTER TABLE "OutgoingMessage" ADD CONSTRAINT "OutgoingMessage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("pkId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingMessage" ADD CONSTRAINT "IncomingMessage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("pkId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
