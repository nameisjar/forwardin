ALTER TABLE "inbox_cleanup_log"
ADD COLUMN "outgoing_deleted_count" INTEGER NOT NULL DEFAULT 0;
