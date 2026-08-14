CREATE INDEX "idx_incoming_message_inbox_conversation"
ON "IncomingMessage"("device_id", "inbox_hidden_at", "from", "received_at");

CREATE INDEX "idx_incoming_message_conversation_read"
ON "IncomingMessage"("device_id", "from", "is_read");

CREATE INDEX "idx_outgoing_message_inbox_conversation"
ON "OutgoingMessage"("device_id", "inbox_hidden_at", "to", "created_at");
