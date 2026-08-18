CREATE TABLE "ChatTemplate" (
    "pk_id" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "title" VARCHAR(128) NOT NULL,
    "message" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTemplate_pkey" PRIMARY KEY ("pk_id")
);

CREATE UNIQUE INDEX "ChatTemplate_id_key" ON "ChatTemplate"("id");
CREATE UNIQUE INDEX "ChatTemplate_user_id_title_key" ON "ChatTemplate"("user_id", "title");
CREATE INDEX "ChatTemplate_user_id_updated_at_idx" ON "ChatTemplate"("user_id", "updated_at");

ALTER TABLE "ChatTemplate"
ADD CONSTRAINT "ChatTemplate_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("pkId")
ON DELETE CASCADE ON UPDATE CASCADE;
