ALTER TABLE "OutgoingMessage" ADD COLUMN "device_id" INTEGER;

-- Primary backfill: session rows still present.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = session."deviceId"
FROM "Session" AS session
WHERE outgoing."device_id" IS NULL
  AND outgoing."sessionId" = session."sessionId";

-- Recover messages whose Session row was already removed from the latest DeviceLog.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = (
  SELECT "deviceId"
  FROM "DeviceLog"
  WHERE "sessionId" = outgoing."sessionId"
  ORDER BY "created_at" DESC
  LIMIT 1
)
WHERE outgoing."device_id" IS NULL
  AND outgoing."sessionId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "DeviceLog" WHERE "sessionId" = outgoing."sessionId"
  );

-- Broadcast messages have an unambiguous device owner.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = broadcast."deviceId"
FROM "Broadcast" AS broadcast
WHERE outgoing."device_id" IS NULL
  AND outgoing."broadcastId" = broadcast."pkId";

-- Last safe fallback: a contact linked to exactly one device.
UPDATE "OutgoingMessage" AS outgoing
SET "device_id" = owner."deviceId"
FROM (
  SELECT outgoing_contact."pkId" AS "outgoingPkId", MIN(contact_device."deviceId") AS "deviceId"
  FROM "OutgoingMessage" AS outgoing_contact
  JOIN "ContactDevice" AS contact_device
    ON contact_device."contactId" = outgoing_contact."contactId"
  WHERE outgoing_contact."device_id" IS NULL
  GROUP BY outgoing_contact."pkId"
  HAVING COUNT(DISTINCT contact_device."deviceId") = 1
) AS owner
WHERE outgoing."pkId" = owner."outgoingPkId";

CREATE INDEX "idx_outgoing_message_device_time"
ON "OutgoingMessage"("device_id", "created_at");

ALTER TABLE "OutgoingMessage"
ADD CONSTRAINT "OutgoingMessage_device_id_fkey"
FOREIGN KEY ("device_id") REFERENCES "Device"("pkId")
ON DELETE SET NULL ON UPDATE CASCADE;
