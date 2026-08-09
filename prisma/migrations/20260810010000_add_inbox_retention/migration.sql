ALTER TABLE "IncomingMessage"
ADD COLUMN "inbox_hidden_at" TIMESTAMP(3);

ALTER TABLE "OutgoingMessage"
ADD COLUMN "inbox_hidden_at" TIMESTAMP(3);

CREATE INDEX "idx_incoming_message_inbox_retention"
ON "IncomingMessage"("device_id", "inbox_hidden_at", "received_at");

CREATE INDEX "idx_outgoing_message_inbox_retention"
ON "OutgoingMessage"("device_id", "inbox_hidden_at", "created_at");

CREATE TABLE "inbox_retention_setting" (
    "pk_id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "grace_days" INTEGER NOT NULL DEFAULT 7,
    "last_cleanup_at" TIMESTAMP(3),
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_retention_setting_pkey" PRIMARY KEY ("pk_id"),
    CONSTRAINT "inbox_retention_setting_singleton" CHECK ("pk_id" = 1),
    CONSTRAINT "inbox_retention_days_range" CHECK ("retention_days" BETWEEN 1 AND 3650),
    CONSTRAINT "inbox_retention_grace_days_range" CHECK ("grace_days" BETWEEN 0 AND 30)
);

CREATE TABLE "inbox_cleanup_log" (
    "pk_id" BIGSERIAL NOT NULL,
    "trigger_type" VARCHAR(20) NOT NULL,
    "triggered_by" VARCHAR(255),
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "incoming_hidden_count" INTEGER NOT NULL DEFAULT 0,
    "outgoing_hidden_count" INTEGER NOT NULL DEFAULT 0,
    "incoming_deleted_count" INTEGER NOT NULL DEFAULT 0,
    "reaction_deleted_count" INTEGER NOT NULL DEFAULT 0,
    "media_deleted_count" INTEGER NOT NULL DEFAULT 0,
    "media_delete_failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_cleanup_log_pkey" PRIMARY KEY ("pk_id")
);

CREATE INDEX "idx_inbox_cleanup_log_created_at"
ON "inbox_cleanup_log"("created_at");

INSERT INTO "inbox_retention_setting" (
    "pk_id",
    "enabled",
    "retention_days",
    "grace_days"
) VALUES (1, true, 90, 7)
ON CONFLICT ("pk_id") DO NOTHING;
