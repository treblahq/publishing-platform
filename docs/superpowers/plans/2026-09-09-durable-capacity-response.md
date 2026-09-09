# Preserve retry semantics after atomic capacity rejection

The account-global reservation trigger already enforces the configured budget.
Migration 0007 aligns the SQL limits with current preflight limits. Do not change
those limits, reservations or the scope of accounting. The remaining defect is
that intake maps the trigger's rejection to HTTP 400 INVALID_PUBLICATION.

Add a failing real-SQLite route test loading all actual migrations and exhausting
capacity through another tenant after a successful preflight. The transaction
must roll back every publication row and return the existing 429 retry-later
contract with publicationAccepted false and a bounded next-UTC-day retry hint.
Recognize only the fixed reservation rejection message, including a bounded
Error.cause chain; other failures must retain existing handling. Never return
raw exception details. Add wrapped-error and unrelated-error regressions.

Run focused tests, full platform verification and independent review before
commit. No production call, migration, budget adjustment or provider work.
