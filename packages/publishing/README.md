# @trebla/publishing

Provider-neutral contracts and a fail-closed client for preparing immutable
publishing envelopes, staging durable handoffs, and uploading artifacts.

```sh
npm install @trebla/publishing@0.1.0
```

Contract validation and local staging perform no network calls. Submission and
uploads require an explicit endpoint and producer credentials supplied by the
consuming application at runtime. No credentials are bundled in this package.

It is released from the public
[`treblahq/publishing-platform`](https://github.com/treblahq/publishing-platform)
repository under the MIT license.
