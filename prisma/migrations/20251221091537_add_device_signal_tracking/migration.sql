-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "health_status" VARCHAR(20) NOT NULL DEFAULT 'healthy',
ADD COLUMN     "pause_reason" VARCHAR(255),
ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "resume_at" TIMESTAMP(3),
ADD COLUMN     "today_message_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "today_message_date" DATE;

-- CreateTable
CREATE TABLE "device_signals" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "device_id" INTEGER NOT NULL,
    "signal_type" VARCHAR(50) NOT NULL,
    "code" INTEGER,
    "message" TEXT,
    "severity" VARCHAR(20) NOT NULL DEFAULT 'warning',
    "action" VARCHAR(50),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_signals_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_signals_id_key" ON "device_signals"("id");

-- CreateIndex
CREATE INDEX "idx_device_signal_device_time" ON "device_signals"("device_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_device_signal_type" ON "device_signals"("device_id", "signal_type");

-- AddForeignKey
ALTER TABLE "device_signals" ADD CONSTRAINT "device_signals_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
