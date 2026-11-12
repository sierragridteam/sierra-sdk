# Sierra SDK

Use the workspace's pinned Node/pnpm toolchain. The canonical spec is schema/openapi.json; never hand-edit generated output. Edit scripts/prepare-schema.mjs for documented generation-only accommodations. Preserve decimal strings, nulls, provenance and archive coverage. Run pnpm verify and pnpm drift, inspect the npm package, and keep publishing behind an explicit authorized release. Fixtures must remain synthetic and schema-validated. No secrets or production captures.

Don't add `Co-Authored-By:` trailers naming an agent or model, or any other AI attribution (such as a "Generated with" footer), to commit messages or pull request descriptions. `.claude/settings.json` turns off Claude Code's default commit trailer; follow the same rule with any other tool.
