ALTER TABLE "OutgoingMessage"
ADD COLUMN "read_receipts" JSONB;

-- Existing read_by rows predate per-reader timestamps. Preserve their readers
-- and use the last message update as an explicitly estimated historical time.
UPDATE "OutgoingMessage" AS outgoing
SET "read_receipts" = (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'readerJid', reader.value,
                'readAt', outgoing."updated_at",
                'estimated', true
            )
        ),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text(outgoing."read_by") AS reader(value)
)
WHERE outgoing."read_by" IS NOT NULL
  AND jsonb_typeof(outgoing."read_by") = 'array'
  AND jsonb_array_length(outgoing."read_by") > 0;
