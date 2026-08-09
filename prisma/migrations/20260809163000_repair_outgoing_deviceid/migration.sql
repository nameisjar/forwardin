-- Repair databases where the previous migration was recorded as applied before
-- its final SQL was written. Every statement is idempotent so this is also safe
-- on databases where device_id already exists.
ALTER TABLE "OutgoingMessage"
ADD COLUMN IF NOT EXISTS "device_id" INTEGER;

-- Active/persisted session rows are the strongest ownership signal.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = owner."deviceId"
FROM (
  SELECT "sessionId", MIN("deviceId") AS "deviceId"
  FROM "Session"
  GROUP BY "sessionId"
  HAVING COUNT(DISTINCT "deviceId") = 1
) AS owner
WHERE outgoing."device_id" IS NULL
  AND outgoing."sessionId" = owner."sessionId";

-- Recover sessions that were removed but still have a device audit trail.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = owner."deviceId"
FROM (
  SELECT DISTINCT ON ("sessionId") "sessionId", "deviceId"
  FROM "DeviceLog"
  WHERE "sessionId" IS NOT NULL
  ORDER BY "sessionId", "created_at" DESC
) AS owner
WHERE outgoing."device_id" IS NULL
  AND outgoing."sessionId" = owner."sessionId";

-- Broadcast records and per-recipient tracking have an explicit device owner.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = broadcast."deviceId"
FROM "Broadcast" AS broadcast
WHERE outgoing."device_id" IS NULL
  AND outgoing."broadcastId" = broadcast."pkId";

UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = broadcast."deviceId"
FROM broadcast_recipients AS recipient
JOIN "Broadcast" AS broadcast
  ON broadcast."pkId" = recipient.broadcast_id
WHERE outgoing."device_id" IS NULL
  AND recipient.message_id IS NOT NULL
  AND (recipient.message_id = outgoing."id" OR recipient.message_id = outgoing."wa_message_id");

-- Incoming messages retain both sessionId and device_id across reconnects.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = owner.device_id
FROM (
  SELECT "sessionId", MIN(device_id) AS device_id
  FROM "IncomingMessage"
  WHERE "sessionId" IS NOT NULL
    AND device_id IS NOT NULL
  GROUP BY "sessionId"
  HAVING COUNT(DISTINCT device_id) = 1
) AS owner
WHERE outgoing."device_id" IS NULL
  AND outgoing."sessionId" = owner."sessionId";

-- A recipient is a safe fallback only when that JID belongs to exactly one
-- device in the persistent Inbox.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = owner.device_id
FROM (
  SELECT "from" AS jid, MIN(device_id) AS device_id
  FROM "IncomingMessage"
  WHERE device_id IS NOT NULL
  GROUP BY "from"
  HAVING COUNT(DISTINCT device_id) = 1
) AS owner
WHERE outgoing."device_id" IS NULL
  AND outgoing."to" = owner.jid;

-- Last safe fallback: a linked contact owned by exactly one device.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = owner."deviceId"
FROM (
  SELECT outgoing_contact."pkId" AS "outgoingPkId",
         MIN(contact_device."deviceId") AS "deviceId"
  FROM "OutgoingMessage" AS outgoing_contact
  JOIN "ContactDevice" AS contact_device
    ON contact_device."contactId" = outgoing_contact."contactId"
  WHERE outgoing_contact."device_id" IS NULL
  GROUP BY outgoing_contact."pkId"
  HAVING COUNT(DISTINCT contact_device."deviceId") = 1
) AS owner
WHERE outgoing."pkId" = owner."outgoingPkId";

CREATE INDEX IF NOT EXISTS "idx_outgoing_message_device_time"
ON "OutgoingMessage"("device_id", "created_at");

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'OutgoingMessage_device_id_fkey'
      AND conrelid = '"OutgoingMessage"'::regclass
  ) THEN
    ALTER TABLE "OutgoingMessage"
    ADD CONSTRAINT "OutgoingMessage_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "Device"("pkId")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$migration$;
