# Delivery Context Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the coupled storage/consumer contract.

**Goal:** Preserve producer options and logical artifact IDs through durable delivery and reconciliation, without changing cleanup database identity.

**Architecture:** The intake already saves the validated full immutable envelope. Read that envelope alongside the delivery row, match the exact delivery intent, and verify stored artifact metadata against original references. Expose logical artifact IDs to adapters while retaining an internal logical-to-storage-ID map for cleanup. No migrations, new D1 queries, producer SDK release, or provider activation is required.

**Tech Stack:** TypeScript, Vitest, authoritative SQLite schema, private adapter-kit types.

- [ ] Reproduce missing providerOptions and UUID artifact substitution with a D1-load regression containing the real serialized approved envelope and differently named database rows.
- [ ] Reconstruct validated delivery context from the immutable envelope, rejecting tenant/payload/operation/adapter or artifact metadata mismatches. Add an optional internal artifact storage-ID map to DeliveryWork. Keep payload and providerOptions separate from trusted adapter config.
- [ ] Add failing consumer and reconciler tests proving providerOptions propagate to validate/deliver/reconcile. Add consumer retention test proving logical IDs reach the adapter but storage IDs reach fenced cleanup.
- [ ] Implement optional providerOptions in private AdapterContext and DeliveryWork, pass it consistently, and map retention IDs at the worker boundary. Preserve compatibility for memory fixtures without a mapping.
- [ ] Run full platform validate, independent review, and a [skip ci] microcommit. Publish the Worker only after all local checks and a fresh free-tier readiness check; do not republish immutable npm 0.1.2.
