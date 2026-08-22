CREATE TABLE "message_poll" (
    "pk_id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "session_id" VARCHAR(128) NOT NULL,
    "conversation_jid" VARCHAR(128) NOT NULL,
    "target_message_id" VARCHAR(255) NOT NULL,
    "target_from_me" BOOLEAN NOT NULL,
    "creator_jid" VARCHAR(128) NOT NULL,
    "encrypted_definition" TEXT NOT NULL,
    "encrypted_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_poll_pkey" PRIMARY KEY ("pk_id")
);

CREATE TABLE "message_poll_vote" (
    "pk_id" SERIAL NOT NULL,
    "poll_id" INTEGER NOT NULL,
    "voter_hash" VARCHAR(64) NOT NULL,
    "selected_option_ids" JSONB NOT NULL,
    "voted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_poll_vote_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "message_poll_device_target_key"
ON "message_poll"("device_id", "target_message_id");

CREATE INDEX "idx_message_poll_conversation"
ON "message_poll"("device_id", "conversation_jid");

CREATE INDEX "idx_message_poll_session" ON "message_poll"("session_id");

CREATE UNIQUE INDEX "message_poll_vote_voter_key"
ON "message_poll_vote"("poll_id", "voter_hash");

CREATE INDEX "idx_message_poll_vote_poll" ON "message_poll_vote"("poll_id");

ALTER TABLE "message_poll_vote"
ADD CONSTRAINT "message_poll_vote_poll_id_fkey"
FOREIGN KEY ("poll_id") REFERENCES "message_poll"("pk_id")
ON DELETE CASCADE ON UPDATE CASCADE;
