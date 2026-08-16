CREATE TABLE "device_outbound_rate_states" (
    "device_id" INTEGER NOT NULL,
    "minute_window_started_at" TIMESTAMP(3) NOT NULL,
    "minute_count" INTEGER NOT NULL DEFAULT 0,
    "hour_window_started_at" TIMESTAMP(3) NOT NULL,
    "hour_count" INTEGER NOT NULL DEFAULT 0,
    "day_window_started_at" DATE NOT NULL,
    "day_count" INTEGER NOT NULL DEFAULT 0,
    "last_reserved_at" TIMESTAMP(3),
    "broadcast_lease_id" INTEGER,
    "broadcast_lease_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_outbound_rate_states_pkey" PRIMARY KEY ("device_id")
);

CREATE TABLE "whatsapp_suppressions" (
    "pk_id" SERIAL NOT NULL,
    "device_id" INTEGER NOT NULL,
    "recipient_key" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(50) NOT NULL DEFAULT 'user_opt_out',
    "source" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_suppressions_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "whatsapp_suppressions_device_recipient_key"
    ON "whatsapp_suppressions"("device_id", "recipient_key");
CREATE INDEX "idx_whatsapp_suppressions_device_time"
    ON "whatsapp_suppressions"("device_id", "updated_at");

ALTER TABLE "device_outbound_rate_states"
    ADD CONSTRAINT "device_outbound_rate_states_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_suppressions"
    ADD CONSTRAINT "whatsapp_suppressions_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
