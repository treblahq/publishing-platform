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
