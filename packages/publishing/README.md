# @trebla/publishing

Provider-neutral contracts and a fail-closed client for preparing immutable
publishing envelopes, staging durable handoffs, and uploading artifacts.

```sh
npm install @trebla/publishing@0.1.2
```

Contract validation and local staging perform no network calls. Submission and
uploads require an explicit endpoint and producer credentials supplied by the
consuming application at runtime. No credentials are bundled in this package.

`createPlatformPublisher({ outboxDirectory })` validates and persists a product
handoff through `prepare(handoff)` without reading credentials or making requests.
For submission, explicitly provide `transport: { baseUrl, clientId, secret }`
when constructing the publisher, then call `submit(handoff)`.

Submission first probes intake with the exact envelope, recovering an existing
acceptance even on a fresh executor without local media. Only an explicit
`ARTIFACT_NOT_READY` response permits sequential temporary-artifact uploads and
resubmission of that same envelope. It never drains unrelated pending work. A
`retry-later` result leaves work pending. Keep the handoff, source media and outbox
for recovery after deferrals or errors. A durable acceptance receipt prevents
re-uploading files on a repeated invocation. Capacity deferrals do not upload
media, and changing content under the same
identity is rejected. Acceptance is not proof of completed provider delivery.

It is released from the public
[`treblahq/publishing-platform`](https://github.com/treblahq/publishing-platform)
repository under the MIT license.
