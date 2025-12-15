-- DropIndex
DROP INDEX "idx_broadcast_name_trgm";

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "broadcast_type" VARCHAR(20);
