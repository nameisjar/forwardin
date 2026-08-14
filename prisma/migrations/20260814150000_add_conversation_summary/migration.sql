CREATE TABLE "Conversation" (
    "pk_id" BIGSERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "jid" VARCHAR(128) NOT NULL,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "contact_id" INTEGER,
    "push_name" VARCHAR(255),
    "group_name" VARCHAR(255),
    "last_message_id" VARCHAR(255),
    "last_message_direction" VARCHAR(10),
    "last_message_at" TIMESTAMP(3),
    "last_message_preview" TEXT,
    "last_media_path" TEXT,
    "last_file_name" TEXT,
    "incoming_count" INTEGER NOT NULL DEFAULT 0,
    "outgoing_count" INTEGER NOT NULL DEFAULT 0,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "conversation_device_jid_key"
ON "Conversation"("device_id", "jid");

CREATE INDEX "idx_conversation_device_latest"
ON "Conversation"("device_id", "last_message_at");

CREATE INDEX "idx_conversation_device_unread"
ON "Conversation"("device_id", "unread_count");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_device_id_fkey"
FOREIGN KEY ("device_id") REFERENCES "Device"("pkId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_contact_id_fkey"
FOREIGN KEY ("contact_id") REFERENCES "Contact"("pkId")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Build one summary for every visible conversation that already exists.
WITH timeline AS (
    SELECT
        "device_id",
        "from" AS jid,
        "id" AS message_id,
        'incoming'::VARCHAR(10) AS direction,
        "received_at" AS message_at,
        "message" AS preview,
        "mediaPath" AS media_path,
        "file_name",
        "contactId" AS contact_id,
        "push_name",
        "group_name",
        ("from" LIKE '%@g.us') AS is_group,
        1 AS incoming_count,
        0 AS outgoing_count,
        CASE WHEN "is_read" THEN 0 ELSE 1 END AS unread_count
    FROM "IncomingMessage"
    WHERE "device_id" IS NOT NULL AND "inbox_hidden_at" IS NULL

    UNION ALL

    SELECT
        "device_id",
        "to" AS jid,
        "id" AS message_id,
        'outgoing'::VARCHAR(10) AS direction,
        "created_at" AS message_at,
        "message" AS preview,
        "mediaPath" AS media_path,
        "file_name",
        "contactId" AS contact_id,
        NULL::VARCHAR(255) AS push_name,
        NULL::VARCHAR(255) AS group_name,
        COALESCE("isGroup", false) OR ("to" LIKE '%@g.us') AS is_group,
        0 AS incoming_count,
        1 AS outgoing_count,
        0 AS unread_count
    FROM "OutgoingMessage"
    WHERE "device_id" IS NOT NULL AND "inbox_hidden_at" IS NULL
),
stats AS (
    SELECT
        "device_id",
        jid,
        SUM(incoming_count)::INTEGER AS incoming_count,
        SUM(outgoing_count)::INTEGER AS outgoing_count,
        SUM(unread_count)::INTEGER AS unread_count,
        BOOL_OR(is_group) AS is_group
    FROM timeline
    GROUP BY "device_id", jid
),
latest AS (
    SELECT DISTINCT ON ("device_id", jid)
        "device_id", jid, message_id, direction, message_at, preview,
        media_path, file_name, contact_id
    FROM timeline
    ORDER BY "device_id", jid, message_at DESC, direction DESC, message_id DESC
),
identity AS (
    SELECT DISTINCT ON ("device_id", jid)
        "device_id", jid, contact_id, push_name, group_name
    FROM timeline
    WHERE direction = 'incoming'
    ORDER BY "device_id", jid, message_at DESC, message_id DESC
)
INSERT INTO "Conversation" (
    "device_id", "jid", "is_group", "contact_id", "push_name", "group_name",
    "last_message_id", "last_message_direction", "last_message_at",
    "last_message_preview", "last_media_path", "last_file_name",
    "incoming_count", "outgoing_count", "unread_count", "updated_at"
)
SELECT
    stats."device_id",
    stats.jid,
    stats.is_group,
    COALESCE(identity.contact_id, latest.contact_id),
    identity.push_name,
    identity.group_name,
    latest.message_id,
    latest.direction,
    latest.message_at,
    latest.preview,
    latest.media_path,
    latest.file_name,
    stats.incoming_count,
    stats.outgoing_count,
    stats.unread_count,
    CURRENT_TIMESTAMP
FROM stats
JOIN latest
  ON latest."device_id" = stats."device_id" AND latest.jid = stats.jid
LEFT JOIN identity
  ON identity."device_id" = stats."device_id" AND identity.jid = stats.jid;

-- Recalculate one conversation after edits, hides, deletes, read-state changes,
-- or identity normalization. The source indexes keep this bounded to one JID.
CREATE OR REPLACE FUNCTION refresh_conversation_summary(
    target_device_id INTEGER,
    target_jid TEXT
) RETURNS VOID AS $$
BEGIN
    IF target_device_id IS NULL OR target_jid IS NULL OR target_jid = '' THEN
        RETURN;
    END IF;

    WITH timeline AS (
        SELECT
            "id" AS message_id,
            'incoming'::VARCHAR(10) AS direction,
            "received_at" AS message_at,
            "message" AS preview,
            "mediaPath" AS media_path,
            "file_name",
            "contactId" AS contact_id,
            "push_name",
            "group_name",
            ("from" LIKE '%@g.us') AS is_group,
            1 AS incoming_count,
            0 AS outgoing_count,
            CASE WHEN "is_read" THEN 0 ELSE 1 END AS unread_count
        FROM "IncomingMessage"
        WHERE "device_id" = target_device_id
          AND "from" = target_jid
          AND "inbox_hidden_at" IS NULL

        UNION ALL

        SELECT
            "id" AS message_id,
            'outgoing'::VARCHAR(10) AS direction,
            "created_at" AS message_at,
            "message" AS preview,
            "mediaPath" AS media_path,
            "file_name",
            "contactId" AS contact_id,
            NULL::VARCHAR(255) AS push_name,
            NULL::VARCHAR(255) AS group_name,
            COALESCE("isGroup", false) OR ("to" LIKE '%@g.us') AS is_group,
            0 AS incoming_count,
            1 AS outgoing_count,
            0 AS unread_count
        FROM "OutgoingMessage"
        WHERE "device_id" = target_device_id
          AND "to" = target_jid
          AND "inbox_hidden_at" IS NULL
    ),
    stats AS (
        SELECT
            SUM(incoming_count)::INTEGER AS incoming_count,
            SUM(outgoing_count)::INTEGER AS outgoing_count,
            SUM(unread_count)::INTEGER AS unread_count,
            BOOL_OR(is_group) AS is_group
        FROM timeline
    ),
    latest AS (
        SELECT message_id, direction, message_at, preview, media_path, file_name, contact_id
        FROM timeline
        ORDER BY message_at DESC, direction DESC, message_id DESC
        LIMIT 1
    ),
    identity AS (
        SELECT contact_id, push_name, group_name
        FROM timeline
        WHERE direction = 'incoming'
        ORDER BY message_at DESC, message_id DESC
        LIMIT 1
    )
    INSERT INTO "Conversation" (
        "device_id", "jid", "is_group", "contact_id", "push_name", "group_name",
        "last_message_id", "last_message_direction", "last_message_at",
        "last_message_preview", "last_media_path", "last_file_name",
        "incoming_count", "outgoing_count", "unread_count", "updated_at"
    )
    SELECT
        target_device_id,
        target_jid,
        stats.is_group,
        COALESCE(identity.contact_id, latest.contact_id),
        identity.push_name,
        identity.group_name,
        latest.message_id,
        latest.direction,
        latest.message_at,
        latest.preview,
        latest.media_path,
        latest.file_name,
        stats.incoming_count,
        stats.outgoing_count,
        stats.unread_count,
        CURRENT_TIMESTAMP
    FROM stats
    JOIN latest ON true
    LEFT JOIN identity ON true
    ON CONFLICT ("device_id", "jid") DO UPDATE SET
        "is_group" = EXCLUDED."is_group",
        "contact_id" = EXCLUDED."contact_id",
        "push_name" = EXCLUDED."push_name",
        "group_name" = EXCLUDED."group_name",
        "last_message_id" = EXCLUDED."last_message_id",
        "last_message_direction" = EXCLUDED."last_message_direction",
        "last_message_at" = EXCLUDED."last_message_at",
        "last_message_preview" = EXCLUDED."last_message_preview",
        "last_media_path" = EXCLUDED."last_media_path",
        "last_file_name" = EXCLUDED."last_file_name",
        "incoming_count" = EXCLUDED."incoming_count",
        "outgoing_count" = EXCLUDED."outgoing_count",
        "unread_count" = EXCLUDED."unread_count",
        "updated_at" = CURRENT_TIMESTAMP;

    IF NOT FOUND THEN
        DELETE FROM "Conversation"
        WHERE "device_id" = target_device_id AND "jid" = target_jid;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_conversation_after_incoming_insert()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."device_id" IS NULL OR NEW."inbox_hidden_at" IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO "Conversation" (
        "device_id", "jid", "is_group", "contact_id", "push_name", "group_name",
        "last_message_id", "last_message_direction", "last_message_at",
        "last_message_preview", "last_media_path", "last_file_name",
        "incoming_count", "outgoing_count", "unread_count", "updated_at"
    ) VALUES (
        NEW."device_id", NEW."from", NEW."from" LIKE '%@g.us', NEW."contactId",
        NEW."push_name", NEW."group_name", NEW."id", 'incoming', NEW."received_at",
        NEW."message", NEW."mediaPath", NEW."file_name", 1, 0,
        CASE WHEN NEW."is_read" THEN 0 ELSE 1 END, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("device_id", "jid") DO UPDATE SET
        "is_group" = "Conversation"."is_group" OR EXCLUDED."is_group",
        "contact_id" = COALESCE(EXCLUDED."contact_id", "Conversation"."contact_id"),
        "push_name" = COALESCE(EXCLUDED."push_name", "Conversation"."push_name"),
        "group_name" = COALESCE(EXCLUDED."group_name", "Conversation"."group_name"),
        "incoming_count" = "Conversation"."incoming_count" + 1,
        "unread_count" = "Conversation"."unread_count" + EXCLUDED."unread_count",
        "last_message_id" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_message_id" ELSE "Conversation"."last_message_id" END,
        "last_message_direction" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_message_direction" ELSE "Conversation"."last_message_direction" END,
        "last_message_at" = GREATEST(EXCLUDED."last_message_at", "Conversation"."last_message_at"),
        "last_message_preview" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_message_preview" ELSE "Conversation"."last_message_preview" END,
        "last_media_path" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_media_path" ELSE "Conversation"."last_media_path" END,
        "last_file_name" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_file_name" ELSE "Conversation"."last_file_name" END,
        "updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_conversation_after_outgoing_insert()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."device_id" IS NULL OR NEW."inbox_hidden_at" IS NOT NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO "Conversation" (
        "device_id", "jid", "is_group", "contact_id",
        "last_message_id", "last_message_direction", "last_message_at",
        "last_message_preview", "last_media_path", "last_file_name",
        "incoming_count", "outgoing_count", "unread_count", "updated_at"
    ) VALUES (
        NEW."device_id", NEW."to", COALESCE(NEW."isGroup", false) OR NEW."to" LIKE '%@g.us',
        NEW."contactId", NEW."id", 'outgoing', NEW."created_at", NEW."message",
        NEW."mediaPath", NEW."file_name", 0, 1, 0, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("device_id", "jid") DO UPDATE SET
        "is_group" = "Conversation"."is_group" OR EXCLUDED."is_group",
        "contact_id" = COALESCE(EXCLUDED."contact_id", "Conversation"."contact_id"),
        "outgoing_count" = "Conversation"."outgoing_count" + 1,
        "last_message_id" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_message_id" ELSE "Conversation"."last_message_id" END,
        "last_message_direction" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_message_direction" ELSE "Conversation"."last_message_direction" END,
        "last_message_at" = GREATEST(EXCLUDED."last_message_at", "Conversation"."last_message_at"),
        "last_message_preview" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_message_preview" ELSE "Conversation"."last_message_preview" END,
        "last_media_path" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_media_path" ELSE "Conversation"."last_media_path" END,
        "last_file_name" = CASE WHEN EXCLUDED."last_message_at" >= "Conversation"."last_message_at" OR "Conversation"."last_message_at" IS NULL THEN EXCLUDED."last_file_name" ELSE "Conversation"."last_file_name" END,
        "updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_conversations_after_incoming_update()
RETURNS TRIGGER AS $$
DECLARE
    conversation_key RECORD;
BEGIN
    FOR conversation_key IN
        WITH changed AS (
            SELECT
                old_row."device_id" AS old_device_id,
                old_row."from" AS old_jid,
                new_row."device_id" AS new_device_id,
                new_row."from" AS new_jid
            FROM old_rows old_row
            JOIN new_rows new_row ON new_row."pkId" = old_row."pkId"
            WHERE ROW(
                old_row."device_id", old_row."from", old_row."message",
                old_row."mediaPath", old_row."file_name", old_row."is_read",
                old_row."received_at", old_row."inbox_hidden_at", old_row."contactId",
                old_row."push_name", old_row."group_name"
            ) IS DISTINCT FROM ROW(
                new_row."device_id", new_row."from", new_row."message",
                new_row."mediaPath", new_row."file_name", new_row."is_read",
                new_row."received_at", new_row."inbox_hidden_at", new_row."contactId",
                new_row."push_name", new_row."group_name"
            )
        ), keys AS (
            SELECT old_device_id AS device_id, old_jid AS jid FROM changed
            UNION
            SELECT new_device_id AS device_id, new_jid AS jid FROM changed
        )
        SELECT device_id, jid FROM keys WHERE device_id IS NOT NULL AND jid IS NOT NULL
    LOOP
        PERFORM refresh_conversation_summary(conversation_key.device_id, conversation_key.jid);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_conversations_after_outgoing_update()
RETURNS TRIGGER AS $$
DECLARE
    conversation_key RECORD;
BEGIN
    FOR conversation_key IN
        WITH changed AS (
            SELECT
                old_row."device_id" AS old_device_id,
                old_row."to" AS old_jid,
                new_row."device_id" AS new_device_id,
                new_row."to" AS new_jid
            FROM old_rows old_row
            JOIN new_rows new_row ON new_row."pkId" = old_row."pkId"
            WHERE ROW(
                old_row."device_id", old_row."to", old_row."message",
                old_row."mediaPath", old_row."file_name", old_row."created_at",
                old_row."inbox_hidden_at", old_row."contactId", old_row."isGroup"
            ) IS DISTINCT FROM ROW(
                new_row."device_id", new_row."to", new_row."message",
                new_row."mediaPath", new_row."file_name", new_row."created_at",
                new_row."inbox_hidden_at", new_row."contactId", new_row."isGroup"
            )
        ), keys AS (
            SELECT old_device_id AS device_id, old_jid AS jid FROM changed
            UNION
            SELECT new_device_id AS device_id, new_jid AS jid FROM changed
        )
        SELECT device_id, jid FROM keys WHERE device_id IS NOT NULL AND jid IS NOT NULL
    LOOP
        PERFORM refresh_conversation_summary(conversation_key.device_id, conversation_key.jid);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_conversations_after_incoming_delete()
RETURNS TRIGGER AS $$
DECLARE
    conversation_key RECORD;
BEGIN
    FOR conversation_key IN
        SELECT DISTINCT "device_id" AS device_id, "from" AS jid
        FROM old_rows
        WHERE "device_id" IS NOT NULL
    LOOP
        PERFORM refresh_conversation_summary(conversation_key.device_id, conversation_key.jid);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_conversations_after_outgoing_delete()
RETURNS TRIGGER AS $$
DECLARE
    conversation_key RECORD;
BEGIN
    FOR conversation_key IN
        SELECT DISTINCT "device_id" AS device_id, "to" AS jid
        FROM old_rows
        WHERE "device_id" IS NOT NULL
    LOOP
        PERFORM refresh_conversation_summary(conversation_key.device_id, conversation_key.jid);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "conversation_incoming_insert"
AFTER INSERT ON "IncomingMessage"
FOR EACH ROW EXECUTE FUNCTION sync_conversation_after_incoming_insert();

CREATE TRIGGER "conversation_incoming_update"
AFTER UPDATE ON "IncomingMessage"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION refresh_conversations_after_incoming_update();

CREATE TRIGGER "conversation_incoming_delete"
AFTER DELETE ON "IncomingMessage"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION refresh_conversations_after_incoming_delete();

CREATE TRIGGER "conversation_outgoing_insert"
AFTER INSERT ON "OutgoingMessage"
FOR EACH ROW EXECUTE FUNCTION sync_conversation_after_outgoing_insert();

CREATE TRIGGER "conversation_outgoing_update"
AFTER UPDATE ON "OutgoingMessage"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION refresh_conversations_after_outgoing_update();

CREATE TRIGGER "conversation_outgoing_delete"
AFTER DELETE ON "OutgoingMessage"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION refresh_conversations_after_outgoing_delete();
