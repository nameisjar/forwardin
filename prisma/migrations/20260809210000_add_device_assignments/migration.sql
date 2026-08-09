CREATE TABLE "device_assignments" (
    "pk_id" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "device_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "assigned_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "device_assignments_id_key" ON "device_assignments"("id");
CREATE UNIQUE INDEX "device_assignments_device_user_key" ON "device_assignments"("device_id", "user_id");
CREATE INDEX "idx_device_assignments_user" ON "device_assignments"("user_id");
CREATE INDEX "idx_device_assignments_assigned_by" ON "device_assignments"("assigned_by_id");

ALTER TABLE "device_assignments"
ADD CONSTRAINT "device_assignments_device_id_fkey"
FOREIGN KEY ("device_id") REFERENCES "Device"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_assignments"
ADD CONSTRAINT "device_assignments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_assignments"
ADD CONSTRAINT "device_assignments_assigned_by_id_fkey"
FOREIGN KEY ("assigned_by_id") REFERENCES "User"("pkId") ON DELETE SET NULL ON UPDATE CASCADE;
