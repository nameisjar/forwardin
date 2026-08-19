ALTER TABLE "OutgoingMessage"
ADD COLUMN "edited_at" TIMESTAMP(3),
ADD COLUMN "quoted_message_id" TEXT,
ADD COLUMN "quoted_from_me" BOOLEAN,
ADD COLUMN "quoted_text" TEXT,
ADD COLUMN "quoted_sender" VARCHAR(255);

ALTER TABLE "IncomingMessage"
ADD COLUMN "quoted_message_id" TEXT,
ADD COLUMN "quoted_from_me" BOOLEAN,
ADD COLUMN "quoted_text" TEXT,
ADD COLUMN "quoted_sender" VARCHAR(255);

CREATE INDEX "idx_outgoing_message_quoted_message_id"
ON "OutgoingMessage"("quoted_message_id");

CREATE INDEX "idx_incoming_message_quoted_message_id"
ON "IncomingMessage"("quoted_message_id");
