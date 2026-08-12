-- Keep only the newest configuration owner for each device. Credential/key
-- rows belonging to superseded session IDs must be removed as one unit.
WITH ranked_configs AS (
    SELECT
        "deviceId",
        "sessionId",
        ROW_NUMBER() OVER (
            PARTITION BY "deviceId"
            ORDER BY "pkId" DESC
        ) AS row_number
    FROM "Session"
    WHERE "id" LIKE 'session-config-%'
), superseded_sessions AS (
    SELECT DISTINCT "sessionId"
    FROM ranked_configs
    WHERE row_number > 1
)
DELETE FROM "Session"
WHERE "sessionId" IN (SELECT "sessionId" FROM superseded_sessions);

-- PostgreSQL partial uniqueness allows the Session table to retain many auth
-- key rows while enforcing exactly one config/session owner per device.
CREATE UNIQUE INDEX "Session_one_config_per_device"
ON "Session" ("deviceId")
WHERE "id" LIKE 'session-config-%';
