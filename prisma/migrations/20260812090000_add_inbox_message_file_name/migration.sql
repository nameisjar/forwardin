ALTER TABLE "OutgoingMessage"
ADD COLUMN "file_name" TEXT;

ALTER TABLE "IncomingMessage"
ADD COLUMN "file_name" TEXT;
