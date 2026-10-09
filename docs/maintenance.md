# Maintenance

OpenCode owns skill loading, MCP transport, OAuth, and credentials. Keep the native
adapters small; detection rules remain in the hosted HAR analyzer.

## Update upstream content

The pinned source, attribution, and file hashes are in `provenance/upstream.json`.
The public content comes from [Hyper Solutions’ Codex plugin](https://github.com/Hyper-Solutions/hypersolutions-codex),
which was adapted from its [Claude Code plugin](https://github.com/Hyper-Solutions/hypersolutions-claude-code).

```bash
npm run audit:content
git clone https://github.com/Hyper-Solutions/hypersolutions-codex.git .work/upstream
node scripts/sync-upstream.mjs --source .work/upstream --check
```

To update, review upstream changes and the counted transformations in
`scripts/upstream-transforms.json`, then regenerate using a full reviewed commit SHA:

```bash
node scripts/sync-upstream.mjs --source .work/upstream --revision FULL_40_CHARACTER_SHA --write
```

Review the resulting diff and run the [tests](verification.md). New files and changed
transformation counts require explicit review. See [provenance](../provenance/README.md)
for the complete update procedure.

## Package layout

The build embeds the complete skill body for OpenCode 2’s native skill registration.
The generated `src/generated-skill.ts` and `dist/` files are build outputs. Companion
references and the Python helper are loaded from the installed skill directory.

Keep the root `server.js` facade and `./server` export: OpenCode 2’s local-directory
loader uses them. Verify both package-directory and package-name installation when
changing entry points. Preserve complete user MCP overrides in both native adapters.

## Prepare a release

Run the [local and native checks](verification.md), then inspect the package:

```bash
npm pack --dry-run
npm audit
```

Update the version and lockfile together, pack the final artifact, and repeat the
native installation tests against it. Include source attribution and license notices.
Do not include credentials, captures, research notes, or machine-specific test output.

`private: true` in `package.json` prevents npm publication. GitHub source availability
is separate from publishing an npm package. A registry release requires reviewing
package ownership, removing that flag, and testing the published install path.
