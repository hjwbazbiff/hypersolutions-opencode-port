# Updating the upstream content

`upstream.json` records every file in the pinned upstream commit, its source SHA-256,
its destination or disposition, and exact port SHA-256 where copied. Thirteen content
files are bundled in full; five repository/platform files have explicit dispositions.
The Python helper is byte-for-byte identical to upstream. Exact, count-checked platform
translations and evidence-backed workflow corrections are in
`scripts/upstream-transforms.json`; all other bytes are retained. The live corrections
cover IP utility authentication, session rotation, HTTPS recording prerequisites,
distinct connection IDs, HAR counts/encoding, client-profile freshness, and
evidence-based API/target error attribution.

Audit the current bundle without a network connection:

```sh
node scripts/sync-upstream.mjs --check
```

For a source-to-port audit, obtain the pinned upstream commit and compare every byte:

```sh
git clone https://github.com/Hyper-Solutions/hypersolutions-codex.git .work/upstream
node scripts/sync-upstream.mjs --source .work/upstream --check
```

The audit reads committed git blobs, so local upstream edits do not silently change
what is copied. To track a new revision:

1. Fetch the upstream checkout and inspect the entire diff from `upstream.json`'s
   commit. Review all new files, API/SDK/product changes, service declarations, licensing,
   helper behavior and platform instructions. Preserve the public/server-side boundary
   in `THIRD_PARTY_NOTICES.md`.
2. Update explicit rules for platform wording or reproduced workflow defects, recording
   the live evidence for any correction to upstream guidance.
   Existing occurrence counts intentionally fail if upstream removed or changed a target.
   Unknown upstream files intentionally fail until explicitly preserved or classified.
3. Regenerate from the reviewed full commit SHA:

   ```sh
   node scripts/sync-upstream.mjs --source .work/upstream --revision FULL_40_CHARACTER_COMMIT_SHA --write
   node scripts/sync-upstream.mjs --source .work/upstream --check
   ```

4. Review the generated content and provenance diff, including every upstream file's
   disposition. Remove any intentionally retired bundled file explicitly after review:
   the sync command does not silently delete files and fails on extra files. Update
   adapter MCP defaults if upstream declarations changed and update release notices.
5. Run package tests, the Python self-test, the full source audit, package packing and
   tarball-install integration checks. Re-check the supported OpenCode release for skill
   discovery, skill IDs and base directories, tool naming (including direct tools and
   Code Mode), MCP CLI initialization and native OAuth behavior. V2 and the legacy V1
   adapter have different native APIs; test both supported entry points. Record live
   checks separately from fixtures; do not commit captures or account-specific results.

`--write` without `--revision` regenerates the currently pinned revision, so fetching a
new HEAD alone cannot upgrade the bundle. The offline audit catches unexpected content
edits; the `--source` audit additionally proves that the manifest is the exact result of
applying the reviewed transformations to that upstream commit. Neither audit alone proves
MCP service behavior, OAuth compatibility, package installation or future SDK accuracy.
