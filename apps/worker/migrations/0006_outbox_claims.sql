ALTER TABLE outbox ADD COLUMN claim_token TEXT;
ALTER TABLE outbox ADD COLUMN claimed_until TEXT;

CREATE INDEX idx_outbox_claims ON outbox (dispatched_at, claimed_until, due_at);
