-- CreateIndex
CREATE INDEX "idx_outgoing_message_broadcast" ON "OutgoingMessage"("broadcastId");

-- CreateIndex
CREATE INDEX "idx_outgoing_message_session_time" ON "OutgoingMessage"("sessionId", "created_at");
