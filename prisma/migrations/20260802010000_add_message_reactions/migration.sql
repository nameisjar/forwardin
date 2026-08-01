CREATE TABLE "message_reaction" (
    "pk_id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "session_id" VARCHAR(128) NOT NULL,
    "conversation_jid" VARCHAR(128) NOT NULL,
    "target_message_id" VARCHAR(255) NOT NULL,
    "target_from_me" BOOLEAN NOT NULL,
    "reactor_jid" VARCHAR(128) NOT NULL,
    "emoji" VARCHAR(64) NOT NULL,
    "reaction_message_id" VARCHAR(255),
    "reacted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reaction_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "message_reaction_state_key"
    ON "message_reaction"("device_id", "session_id", "target_message_id", "reactor_jid");

CREATE INDEX "idx_message_reaction_conversation"
    ON "message_reaction"("device_id", "conversation_jid");

CREATE INDEX "idx_message_reaction_target"
    ON "message_reaction"("device_id", "target_message_id", "target_from_me");

ALTER TABLE "message_reaction"
    ADD CONSTRAINT "message_reaction_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "Device"("pkId")
    ON DELETE CASCADE ON UPDATE CASCADE;
