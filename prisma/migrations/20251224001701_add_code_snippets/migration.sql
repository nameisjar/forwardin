-- CreateTable
CREATE TABLE "code_snippets" (
    "pkId" SERIAL NOT NULL,
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "code" TEXT NOT NULL,
    "language" VARCHAR(50) NOT NULL,
    "share_token" VARCHAR(64) NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_snippets_pkey" PRIMARY KEY ("pkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "code_snippets_id_key" ON "code_snippets"("id");

-- CreateIndex
CREATE UNIQUE INDEX "code_snippets_share_token_key" ON "code_snippets"("share_token");

-- CreateIndex
CREATE INDEX "code_snippets_user_id_idx" ON "code_snippets"("user_id");

-- CreateIndex
CREATE INDEX "code_snippets_share_token_idx" ON "code_snippets"("share_token");

-- AddForeignKey
ALTER TABLE "code_snippets" ADD CONSTRAINT "code_snippets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("pkId") ON DELETE CASCADE ON UPDATE CASCADE;
