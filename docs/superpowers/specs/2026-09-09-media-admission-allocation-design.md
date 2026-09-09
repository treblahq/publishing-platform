# Finite public-media admission allocation

This implements the durable admission component of the approved publication
media gateway, not gateway activation or Free CPU certification.

## Choice and boundaries

Per-tenant counters do not protect shared account headroom. An in-memory counter
also resets on a fresh isolate. Use one persistent allocation row per account,
shared by every gateway tenant, and one conditional atomic update per admission.
Do not allocate from a browser request, refresh from guessed usage, reset at
midnight, refund failed requests or create any rows on the public path.

The trusted provisioning boundary must reserve the allocation against measured
account-wide headroom, including other workloads and prior allocations. It is
not implemented by this request-path component. Missing allocation denies.
Automatic provisioning, real account settings, route wiring and remote migration
remain outside this local change.

## Stored allocation and reservation

Migration 0011 stores an account key, enabled flag, measured/expiry Unix
milliseconds and integer ceilings/reserved counters for D1 reads, D1 writes and
R2 Class B operations. The account key is the primary key: no tenant dimension
and no per-request table. All counters/ceilings are nonnegative safe integers;
reserved never exceeds its ceiling. Expiry is after measurement and no more
than fifteen minutes later. Counters survive fresh callers and expiry.

The factory receives the trusted account key, a copied conservative cost vector
and a clock. It exposes only `admit(): Promise<boolean>`, matching the existing
transport dependency. Costs must be positive safe integers, with at least two
D1 reads, one D1 write and two R2 Class B operations. These are lower bounds,
not a claim that the current resolver scans only two rows. Production costs
must be measured and conservatively bounded before configuration.

An invalid account/cost/clock denies before SQL. For a valid input, a single
conditional UPDATE requires enabled state, a current allocation, same UTC day
as measurement and enough remaining capacity in every dimension. Increment all
three counters atomically. Return true only for exactly one confirmed changed
row. Missing, expired, disabled, depleted, error or ambiguous metadata denies.
An uncertain response may have consumed an allocation; never refund or retry
inside the admission function. A fresh request must reserve again.

## Safety limitations that must remain visible

This reservation bounds approved gateway work against an existing allocation.
Denied requests still invoke the Worker and attempt one indexed D1 operation;
they are not free or covered by the accepted-work counter. Production acceptance
also requires a bounded denial/abuse strategy, conservative resolver costs,
exclusive account allocation provisioning and representative Free CPU evidence.
This component must not be described as protecting arbitrary unrelated account
traffic or guaranteeing zero cost on its own. Do not enable public transport.

The [Workers limits documentation](https://developers.cloudflare.com/workers/platform/limits/)
still lists 10 ms for Free HTTP requests and explains that occasional overruns
can be tolerated by an isolate. Zero observed errors therefore does not prove
sustainable headroom. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
separately meters Class B reads; free egress is not unlimited free read operations.
These sources were rechecked September 9, 2026; no numeric provider entitlement
is hard-coded into the allocation implementation.

## Evidence

Use real migrations and Node SQLite. Prove shared consumption across callers,
exact last admission, no partial multi-resource reservation, no lost-update
oversubscription under overlapping calls, fresh-caller persistence, strict
expiry/day boundaries, no reset/refund, invalid input/no SQL, and uncertain
write response/no refund. Compose the real admission function with the existing
HTTP transport to prove denial reaches neither resolver nor bucket, while an
admitted request still follows existing grant and object validation. No network
or real provider calls are needed. Full platform checks and independent review
precede commit.
