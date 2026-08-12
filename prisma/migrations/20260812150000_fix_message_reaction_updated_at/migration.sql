-- Some databases created through older schema synchronization lost the
-- updated_at default even though the original table migration defined it.
-- Keep raw SQL inserts and future Prisma writes consistent.
ALTER TABLE "message_reaction"
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
