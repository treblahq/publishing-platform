INSERT INTO capacity_limits
  (resource, free_allowance, internal_limit, warning_limit, reject_limit)
VALUES
  ('d1Rows', 100000, 70000, 42000, 49000),
  ('queueOperations', 10000, 7000, 4200, 4900),
  ('r2Bytes', 10737418240, 7516192768, 4294967296, 5261334938);

CREATE TRIGGER capacity_reservation_guard
BEFORE INSERT ON capacity_reservations
WHEN (
  COALESCE((
    SELECT SUM(reservation.amount)
    FROM capacity_reservations AS reservation
    WHERE reservation.resource = NEW.resource
      AND reservation.state = 'reserved'
      AND reservation.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ), 0)
  + COALESCE((
    SELECT SUM(usage.used)
    FROM capacity_usage AS usage
    WHERE usage.resource = NEW.resource
      AND usage.window_start = (
        SELECT MAX(latest.window_start)
        FROM capacity_usage AS latest
        WHERE latest.tenant_id = usage.tenant_id
          AND latest.resource = usage.resource
      )
  ), 0)
  + NEW.amount
) >= (SELECT reject_limit FROM capacity_limits WHERE resource = NEW.resource)
BEGIN
  SELECT RAISE(ABORT, 'free-tier capacity reservation rejected');
END;
