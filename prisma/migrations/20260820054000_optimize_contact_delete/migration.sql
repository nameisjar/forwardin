-- Preserve Inbox history when a contact is removed. Messages remain available
-- and can be matched to a newly-created contact again by their WhatsApp JID.
ALTER TABLE "IncomingMessage"
DROP CONSTRAINT IF EXISTS "IncomingMessage_contactId_fkey";

ALTER TABLE "IncomingMessage"
ADD CONSTRAINT "IncomingMessage_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("pkId")
ON DELETE SET NULL ON UPDATE CASCADE;

-- PostgreSQL does not automatically index the referencing side of foreign
-- keys. These indexes keep SET NULL and contact deletion proportional to the
-- selected contact instead of scanning the complete message history.
CREATE INDEX IF NOT EXISTS "idx_incoming_message_contact_id"
ON "IncomingMessage"("contactId");

CREATE INDEX IF NOT EXISTS "idx_outgoing_message_contact_id"
ON "OutgoingMessage"("contactId");

CREATE INDEX IF NOT EXISTS "idx_conversation_contact_id"
ON "Conversation"("contact_id");
