# DNS Baseline Input Validation

The real comparator currently reports `safe: true` for two malformed objects
containing only `records: []`. A cutover decision must require valid evidence,
not merely the absence of detected differences. Query coverage must also match.

Scope: `scripts/compare-dns-baseline.ts`, `scripts/capture-dns-baseline.ts` and
`scripts/dns-baseline.test.ts`. No DNS changes, provider calls or deployments.

- Reproduce malformed evidence, duplicate-key shadowing and missing-query
  coverage through the actual comparator before changing code.
- Validate version, nonempty domain, valid capture timestamp, nonempty record
  array, record names, supported types and string answer arrays. Reject duplicate
  case-insensitive name/type keys and malformed values with generic errors.
- Require identical query-key coverage before comparing values. A missing DNS
  answer is represented by an explicit empty values array, never an absent query.
- Deduplicate capture queries before sending requests, so repeated explicit and
  default queries do not create ambiguous baselines. Preserve opaque TXT/CAA.
- Preserve valid web-only changes and protected-record mutation behavior.
- Run focused tests, full validation and independent specification/quality
  review. Capture new uniquely named baselines after passing; retain old files.

This validates evidence shape and coverage, not DNS propagation, origin identity,
full zone settings, or authorization to modify mail and managed Worker bindings.
