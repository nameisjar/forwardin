-- Enable trigram extension for fast ILIKE/contains search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Recreate trigram index for searching broadcast name with ILIKE/contains
CREATE INDEX IF NOT EXISTS "idx_broadcast_name_trgm" ON "Broadcast" USING GIN ("name" gin_trgm_ops);