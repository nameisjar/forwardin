-- CreateTable
CREATE TABLE "WhatsAppGroup" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "group_id" VARCHAR(255) NOT NULL,
    "group_name" VARCHAR(255) NOT NULL,
    "participants" INTEGER DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "session_id" VARCHAR(255),
    "device_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppGroup_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppGroup_id_key" ON "WhatsAppGroup"("id");

-- CreateIndex
CREATE INDEX "WhatsAppGroup_session_id_idx" ON "WhatsAppGroup"("session_id");

-- CreateIndex
CREATE INDEX "WhatsAppGroup_device_id_is_active_idx" ON "WhatsAppGroup"("device_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppGroup_group_id_device_id_key" ON "WhatsAppGroup"("group_id", "device_id");

-- AddForeignKey
ALTER TABLE "WhatsAppGroup" ADD CONSTRAINT "WhatsAppGroup_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
