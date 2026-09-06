-- Requeue web deliveries stranded after the legacy queue was retired. A new,
-- deterministic outbox row avoids reopening historical dispatch records.
INSERT INTO outbox (
  id, tenant_id, delivery_id, event_type, payload_json, due_at,
  dispatched_at, attempts, claim_token, claimed_until
)
SELECT
  'production-promotion:' || delivery.id,
  delivery.tenant_id,
  delivery.id,
  'delivery.production_promotion',
  json_object('deliveryId', delivery.id),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  0,
  NULL,
  NULL
FROM deliveries AS delivery
WHERE delivery.adapter = 'web.r2'
  AND delivery.state IN ('planned', 'ready', 'needs_attention')
ON CONFLICT(id) DO UPDATE SET
  due_at = excluded.due_at,
  dispatched_at = NULL,
  attempts = 0,
  claim_token = NULL,
  claimed_until = NULL;

UPDATE deliveries
SET state = 'ready',
    due_at = NULL,
    lease_expires_at = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE adapter = 'web.r2'
  AND state IN ('planned', 'ready', 'needs_attention');
