CREATE TABLE "inbox_profile_cache" (
    "pk_id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "jid" VARCHAR(128) NOT NULL,
    "image_data" BYTEA,
    "mime_type" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "fetched_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_profile_cache_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "inbox_profile_cache_device_jid_key"
    ON "inbox_profile_cache"("device_id", "jid");

CREATE INDEX "idx_inbox_profile_cache_device_status"
    ON "inbox_profile_cache"("device_id", "status");

CREATE INDEX "idx_inbox_profile_cache_retry"
    ON "inbox_profile_cache"("status", "next_retry_at");

ALTER TABLE "inbox_profile_cache"
    ADD CONSTRAINT "inbox_profile_cache_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "Device"("pkId")
    ON DELETE CASCADE ON UPDATE CASCADE;
