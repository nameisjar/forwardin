ALTER TABLE "message_poll_vote"
ADD COLUMN "encrypted_voter_jid" TEXT,
ADD COLUMN "encrypted_voter_name" TEXT,
ADD COLUMN "is_own_vote" BOOLEAN NOT NULL DEFAULT false;
