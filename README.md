# Publishing Platform

Durable, provider-pluggable delivery infrastructure for Trebla products.

The platform accepts immutable publication envelopes and coordinates delivery
to web, push, social, and video adapters. It is designed to fail closed before
crossing configured free-tier budgets.

## Development

Use Node.js 24 and run:

```sh
npm install
npm run validate
```

Provider credentials, producer signing secrets, production data, and raw
provider payloads must never be committed to this repository.

The isolated manual rollout procedure is documented in
[`docs/runbooks/staging.md`](docs/runbooks/staging.md).

Producer applications can prepare publications and artifact metadata without
network access. The adoption sequence and safety gates are documented in
[`docs/runbooks/producer_adoption.md`](docs/runbooks/producer_adoption.md).
The audited public-package procedure is documented in
[`docs/runbooks/package_release.md`](docs/runbooks/package_release.md).

## DNS cutover guard

Capture the public web, mail, SPF, DMARC, CAA, verification, and known DKIM
record sets before a cutover. DKIM selectors cannot be enumerated through DNS,
so pass every configured selector explicitly:

```sh
node scripts/capture-dns-baseline.ts openings.dev before.json \
  selector._domainkey.openings.dev:TXT
node scripts/capture-dns-baseline.ts openings.dev after.json \
  selector._domainkey.openings.dev:TXT
node scripts/compare-dns-baseline.ts before.json after.json
```

The comparison permits changes only to apex or `www` A, AAAA, and CNAME
records. Any mutation to MX, SPF, DKIM, DMARC, CAA, verification records, or an
unexpected hostname exits unsuccessfully and blocks the cutover. Baseline
files contain public DNS data only; use dated operational evidence rather than
committing ad-hoc captures to the repository.
