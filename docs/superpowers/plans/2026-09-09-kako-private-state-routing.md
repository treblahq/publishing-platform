# Kako Private State Routing

Goal: stop assuming that `publisher-state` belongs to the executor repository
before a future clean public/private split. Keep the current private history and
all publishing activation unchanged.

## Bounded implementation

1. In the existing isolated Kako publisher worktree, add a strict private-state
   repository identity resolver. Require a dedicated `PUBLISHING_STATE_TOKEN`,
   never fall back to the executor's GitHub token. Resolve the original immutable
   repository ID `1349928184` read-only through the GitHub API. Accept only that
   numeric ID, `private: true`, and the current exact name
   `turmadokako/social-publisher` or the planned exact name
   `turmadokako/social-publisher-private`. Emit only an allowlisted repository
   name. Reject redirects, malformed responses and errors without secret/raw
   provider diagnostics. Bound requests and response sizes.
2. Before each existing `publisher-state` checkout in the four workflows
   `story-first-publisher`, `activate-now`, `continuous-bootstrap`, and
   `media-snapshot`, resolve that identity and explicitly set the repository and
   dedicated token on checkout. Preserve branch/path and existing serialized
   state writes. Do not change schedules, dispatch a run, rename a repository,
   alter visibility, or pretend this hydrates private editorial inputs.
3. Write failing Node tests first: wrong ID, public repository, wrong name,
   missing dedicated token despite executor token, redirects/error redaction,
   bounded response and workflow coverage/order/token scope. Existing workflow
   contracts must continue to pass or be updated only for this intended routing.
4. Run focused tests, full repository tests, typecheck, lint and diff checks;
   independent specification then quality review. Commit only after passing.
   Keep work on the isolated branch; no live calls or deployment needed.

The dedicated secret must be provisioned before using these branch workflows.
This is not a public cutover: private source/input hydration, public logs and
artifact boundaries, media release access and trigger ownership remain separate
acceptance gates. Any discovered conflict with those boundaries should be
reported without widening this task.
