# Bound HTTP-triggered outbox work

The approved Free-only constraint requires avoiding backlog-sized work on HTTP
intake. Maintenance isolation removed the repeated maintenance chain, but the
remaining immediate outbox dispatcher can still claim 50 unrelated due rows.

Implement the existing immediate wake-up with a fixed one-row dispatch limit.
Keep the scheduled path's existing 50-row limit explicit and unchanged. Do not
change durable claims, queue delivery, retry semantics, cron frequency, capacity
admission, provider ownership or production configuration. Publications with
multiple deliveries may wait for the existing scheduled drain; no row is dropped.

Write a failing real-SQLite router regression with several eligible outbox rows:
accepted HTTP intake must claim/send/mark exactly one; the rest remain unclaimed
and undispatched. Assert the scheduled path still binds a limit of 50. Run the
focused and full platform suites, lint, typecheck, build and secret scan; get an
independent review before a microcommit. This bounds immediate work, but does not
prove that HTTP or scheduled invocations meet the Free CPU limit. No deploy.

Implemented and independently reviewed September 9 UTC. After correcting a
fixture's required enabled fields, the regression failed with three dispatched
rows instead of one against the original implementation; it passed after the
bound reached the atomic claim. Full verification passed 707 tests across 93
files, lint, typecheck, build and secret scan. A fresh real local-runtime
rehearsal also passed Worker-restart receipt replay with exactly one publication,
delivery, receipt, attempt and upload. No production operation was performed.
