-- CreateIndex
CREATE INDEX "idx_broadcast_device_schedule" ON "Broadcast"("deviceId", "schedule");

-- CreateIndex
CREATE INDEX "idx_broadcast_device_name" ON "Broadcast"("deviceId", "name");

-- CreateIndex
CREATE INDEX "idx_broadcast_device_status_sent_schedule" ON "Broadcast"("deviceId", "status", "isSent", "schedule");
