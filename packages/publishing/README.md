# @trebla/publishing

Provider-neutral contracts and a fail-closed client for preparing immutable
publishing envelopes, staging durable handoffs, and uploading artifacts.

```sh
npm install @trebla/publishing@0.1.1
```

Contract validation and local staging perform no network calls. Submission and
uploads require an explicit endpoint and producer credentials supplied by the
consuming application at runtime. No credentials are bundled in this package.

`createPlatformPublisher({ outboxDirectory })` validates and persists a product
handoff through `prepare(handoff)` without reading credentials or making requests.
For submission, explicitly provide `transport: { baseUrl, clientId, secret }`
when constructing the publisher, then call `submit(handoff)`.

Submission uploads that handoff's temporary artifacts sequentially before
submitting its exact envelope. It never drains unrelated pending work. A
`retry-later` result leaves work pending. Keep the handoff, source media and outbox
for recovery after deferrals or errors. A durable acceptance receipt prevents
re-uploading files on a repeated invocation; changing content under the same
identity is rejected. Acceptance is not proof of completed provider delivery.

It is released from the public
[`treblahq/publishing-platform`](https://github.com/treblahq/publishing-platform)
repository under the MIT license.
