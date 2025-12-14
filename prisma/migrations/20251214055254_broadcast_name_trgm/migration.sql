-- Enable trigram extension for fast ILIKE/contains search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for searching broadcast name with ILIKE/contains
CREATE INDEX IF NOT EXISTS "idx_broadcast_name_trgm" ON "Broadcast" USING GIN ("name" gin_trgm_ops);

-- Optional: help combine deviceId filter + name search (planner can bitmap-and btree+gin)
-- Existing btree index already exists: idx_broadcast_device_name