# DNS Text Integrity Repair

> Preserve opaque DNS data before any domain cutover; no DNS mutations are part of this change.

## Evidence and design

The current `normalizeDnsAnswers` lowercases all record data and strips quotes
and a trailing period regardless of type. This can hide a case-only change in a
verification token or DKIM key. Preserving raw data for TXT and CAA is the
conservative choice: representation-only changes may block a cutover for review,
but actual text changes must never disappear. Domain-valued A/AAAA/CNAME/MX data
may retain the existing deterministic case/trailing-dot normalization.

Alternatives rejected: keeping universal lowercasing loses information;
introducing a full DNS presentation parser expands this bounded repair. The
owner requested autonomous execution of migration safety fixes.

## Implementation and verification

- [x] Add a regression proving mixed-case TXT content survives normalization
  and a case-only token mutation is rejected by the real comparison guard.
- [x] Make record type explicit at normalization and pass it from the DNS query.
  Preserve TXT/CAA presentation bytes, including quotes and final periods;
  retain deterministic sorting/deduplication without collapsing distinct texts.
- [x] Test host-valued normalization separately from opaque data and verify
  call sites. No network, credentials, database or production changes.
- [x] Run focused tests, complete platform validation and independent spec then
  quality review before commit. Fresh cutover baselines must be captured after
  this fix; old lowercased snapshots cannot recover their original text.

DNS response-status validation and record-type filtering are separate diagnostic
concerns and are not silently declared resolved by this narrow repair.

## Evidence

Four regression failures preceded the fix. All 13 focused tests subsequently
passed. Full platform validation passed 801 tests across 97 files, generated
types, build, lint, typecheck and the known credential-pattern scan. Independent
specification and quality reviews found no issues. No DNS mutation or deployment
was part of this correction.
