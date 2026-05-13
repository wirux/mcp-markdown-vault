## [2026-05-13] Known Issues / Gotchas

- VaultIndexer watch loop: onFileIndexed fires after indexAll drain. meta/ exclusion prevents cascade.
- BacklinkIndex subscription (index.ts:194-199) uses old setOnFileIndexed — Task 7 should update to addOnFileIndexed in composition root
- contract-template.ts generateContractTemplate has dead _vaultContext first param — Task 6 removes it
- vault-resource-overview.test.ts: currently asserts contract content IS present — Task 3 must invert those assertions
- Overview template test currently asserts managed_by: user — Task 5 adds mode param

- review-work QA/context-mining subagents failed to launch with `UnknownError`, so verification relied on local targeted test/lint/build plus successful oracle review launches.
