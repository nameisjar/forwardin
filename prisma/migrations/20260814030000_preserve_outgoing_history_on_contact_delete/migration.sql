ALTER TABLE "OutgoingMessage"
DROP CONSTRAINT IF EXISTS "OutgoingMessage_contactId_fkey";

ALTER TABLE "OutgoingMessage"
ADD CONSTRAINT "OutgoingMessage_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("pkId")
ON DELETE SET NULL ON UPDATE CASCADE;
