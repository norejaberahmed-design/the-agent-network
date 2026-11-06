-- Store the exact approval payload as authenticated ciphertext.
-- Nullable columns preserve historical records; legacy approvals without ciphertext
-- are intentionally non-executable and must never be reconstructed from previews.
ALTER TABLE "ActionApproval"
  ADD COLUMN "encryptedPayload" TEXT,
  ADD COLUMN "payloadNonce" VARCHAR(32),
  ADD COLUMN "payloadAuthTag" VARCHAR(32),
  ADD COLUMN "payloadKeyVersion" INTEGER;

ALTER TABLE "ActionApproval"
  ADD CONSTRAINT "ActionApproval_payload_vault_complete_check"
  CHECK (
    ("encryptedPayload" IS NULL AND "payloadNonce" IS NULL AND "payloadAuthTag" IS NULL AND "payloadKeyVersion" IS NULL)
    OR
    ("encryptedPayload" IS NOT NULL AND "payloadNonce" IS NOT NULL AND "payloadAuthTag" IS NOT NULL AND "payloadKeyVersion" = 1)
  );
