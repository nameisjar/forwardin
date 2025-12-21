-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "pkId" SERIAL NOT NULL,
    "broadcast_id" INTEGER NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "jid" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "error_msg" TEXT,
    "message_id" VARCHAR(128),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE INDEX "idx_broadcast_recipient_status" ON "broadcast_recipients"("broadcast_id", "status");

-- CreateIndex
CREATE INDEX "idx_broadcast_recipient_batch" ON "broadcast_recipients"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "idx_broadcast_recipient_unique" ON "broadcast_recipients"("broadcast_id", "phone");

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "Broadcast"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
