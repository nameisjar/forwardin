CREATE TABLE "incoming_message_secret" (
    "pk_id" SERIAL NOT NULL,
    "message_id" TEXT NOT NULL,
    "device_id" INTEGER NOT NULL,
    "session_id" VARCHAR(128) NOT NULL,
    "sender_jid" VARCHAR(128) NOT NULL,
    "sender_alt_jid" VARCHAR(128),
    "encrypted_secret" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_message_secret_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "incoming_message_secret_message_id_key"
ON "incoming_message_secret"("message_id");

CREATE INDEX "idx_incoming_message_secret_device_session"
ON "incoming_message_secret"("device_id", "session_id");

ALTER TABLE "incoming_message_secret"
ADD CONSTRAINT "incoming_message_secret_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "IncomingMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
