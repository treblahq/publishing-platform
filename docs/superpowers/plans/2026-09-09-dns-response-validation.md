# DNS Response Validation

> Fail closed on DNS query failures before relying on a domain-cutover baseline.

## Scope and design

The current capture trusts JSON shape and treats a missing Answer array as an
empty successful answer, even for SERVFAIL. It also labels every returned answer
with the requested type, including CNAME chain entries. Keep queries read-only,
bounded and explicit: require a valid DNS status, reject truncation or operational
errors, and retain only matching numeric answer types. NXDOMAIN is an explicit
allowed absence; successful NODATA is also empty. No DNS writes or rollout.

## Task

Own `scripts/capture-dns-baseline.ts` and `scripts/dns-baseline.test.ts` only.

- [x] Reproduce SERVFAIL falsely accepted as an empty answer and CNAME data
  incorrectly labeled TXT using stubbed HTTP responses through `queryDnsRecord`.
- [x] Validate status 0 or 3, reject truncated responses and malformed Answer
  arrays/entries. Require numeric supported answer type and string data for each
  entry; ignore valid chain entries of other types rather than relabeling them.
- [x] Add an explicit bounded request timeout and maximum 256 KiB JSON body,
  reading incrementally and cancelling oversized responses. Do not log raw bodies.
- [x] Test valid NODATA/NXDOMAIN, matching-type extraction, HTTP/JSON failures,
  malformed entries, truncation and oversized body. Preserve raw TXT/CAA values.
- [x] Run focused tests, full platform validation and independent specification
  then quality review. Capture new baselines only after these checks pass.

This is response validation, not proof of registrar control, complete zone
settings backup, provider acceptance, or permission to change email/DKIM records.

Verification: 37 regression failures before implementation; 57 focused tests
passed afterward. Full validation passed 845 tests across 97 files, plus build,
lint, type checks and secret scanning. Independent specification and quality
reviews passed. No DNS mutation or deploy was performed.
