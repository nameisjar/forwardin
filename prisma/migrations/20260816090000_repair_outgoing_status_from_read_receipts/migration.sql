-- A non-empty read receipt is authoritative evidence that the message was sent.
UPDATE "OutgoingMessage"
SET
    "status" = 'read',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" IN ('error', 'failed')
  AND jsonb_array_length(
      CASE
          WHEN jsonb_typeof("read_by") = 'array' THEN "read_by"
          ELSE '[]'::jsonb
      END
  ) > 0;
