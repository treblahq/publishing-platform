# Fresh producer recovery rehearsal

Extend the opt-in local runtime rehearsal to satisfy the approved gateway's
fresh-executor recovery gate without any production calls. Use the existing
public package publisher and its persisted handoff, not a hand-built replay.

Run the producer in a separate short-lived Node process, with only fixture
credentials and a strictly validated loopback origin. Its HTTPS package transport
may use a fixed synthetic HTTPS origin mapped by an explicit fetch adapter to
that loopback origin; reject every other target and all redirects. Do not weaken
the production package's HTTPS requirement. Keep all existing Wrangler process,
environment, timeout and cleanup protections.

First producer stages and submits a fixture handoff. Simulate response loss only
after real local intake has returned acceptance: consume that response but throw
before the package can persist acknowledgement. Assert the pending handoff exists
and no accepted receipt exists. Stop the first producer and Worker; delete only
the disposable original fixture media. Restart the Worker and launch a fresh
producer process, which reads only the saved handoff and uses a new publisher
instance. It must recover the remote acceptance before attempting media upload.
Assert recovery sent zero PUT requests, one acknowledged publication and the
same verified shadow receipt. Inspect actual local D1 for exactly one publication,
delivery, receipt, attempt and upload. Do not claim actual provider ingestion,
public media gateway acceptance, or Free CPU proof.

Write failing focused tests first for loopback mapping, redirect rejection,
response-loss conditions and persisted-handoff recovery as appropriate. A helper
may live in tooling/rehearse-producer.mjs with its focused test. Runtime changes
belong only in tooling/rehearse-runtime.mjs and its test. Execute the real opt-in
rehearsal after tests and independent spec/quality review. No npm release, remote
migration, deploy, provider calls or production credentials.
