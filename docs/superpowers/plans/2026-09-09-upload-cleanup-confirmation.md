# Confirm upload cleanup ownership before deletion

The artifact collector already refuses storage deletion without an exact one-row
claim acknowledgement. The upload collector only excludes zero, allowing absent
or invalid database metadata to proceed. Apply the same fail-closed requirement
to upload cleanup without changing eligibility, budgets or retention policy.

Add real-SQLite tests replacing only the returned claim metadata after the actual
write. Missing metadata, missing changes and invalid counts must stop before R2,
reservation release and cursor advance. Keep the upload retryable. Existing zero
and one-row behavior must remain. Observe failing tests before the minimal guard,
then run focused/full verification and independent review. No remote operation.
