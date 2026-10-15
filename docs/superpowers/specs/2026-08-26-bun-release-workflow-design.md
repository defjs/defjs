# Bun-Only Release Workflow Design

## Goal

Replace Changesets with a small Bun-only release path for four independently versioned packages while preserving selective publication, peer compatibility, artifact verification, and step-scoped npm credentials.

## Runtime and version policy

- Bun `1.4.0` is the only development, test, build, packaging, and publishing runtime.
- Node.js and Deno are not test or publishing targets.
- `package.json` is the only machine-readable source of package versions and dependency ranges.
- The first planned Core release is `@defjs/core@0.4.0`; adapters advertise only `@defjs/core: ^0.4.0`.
- Packages are versioned and published independently. A Core change triggers adapter tests, not automatic adapter releases.
- A published adapter is released again only when its artifact, public metadata, implementation, or peer range changes.

## Package contract

`@defjs/opentelemetry-server`, `@defjs/react`, and `@defjs/vue` use the local Core workspace for development and expose Core as a required peer to consumers:

```json
{
  "devDependencies": {
    "@defjs/core": "workspace:^"
  },
  "peerDependencies": {
    "@defjs/core": "^0.4.0"
  }
}
```

Core remains external in all adapter bundles. Build configuration uses `Bun.file` and `Bun.write` instead of `node:fs/promises`. Published package manifests do not claim a Node.js engine requirement.

Package READMEs and the license remain in their tarballs; repository-wide guides and examples remain on the documentation site and are not copied into every package artifact.

## Verification model

The repository exposes one `bun run verify` gate that runs lint, formatting, the release-target unit test, workspace tests, build/typecheck, and a packed-consumer E2E.

The packed-consumer E2E creates tarballs from all four `dist` directories, installs them into a clean directory outside workspace resolution, validates their published manifests, typechecks public declarations, and executes a Bun runtime smoke test.

CI runs this full gate on pull requests and pushes to `main`. Release does not repeat it.

## GitHub Actions

Only two workflow files remain, and action references use major-version tags rather than commit hashes:

- `ci.yml`: one `checks` job that installs with Bun and runs `bun run verify`.
- `release.yml`: one `publish` job that builds and publishes the selected package.

Release tags have one of these exact forms:

- `release-core-vX.Y.Z`
- `release-opentelemetry-server-vX.Y.Z`
- `release-react-vX.Y.Z`
- `release-vue-vX.Y.Z`

The publish job checks out the tag, installs with `bun ci`, uses `release-target.ts` to validate the tag and selected manifest, runs `bun --bun run build` only in the selected package, and runs `bun publish --access public` from its `dist` directory. `NPM_CONFIG_TOKEN` is available only to the publish step.

Release relies on successful `main` CI plus repository release-tag protection and the `npm` environment for source and approval policy.

## One-time migration

- Preserve the pending Changesets prose in a neutral `0.4.0` release-notes draft.
- Remove `.changeset`, Changesets dependencies, commands, CI jobs, and release action.
- Remove `_checks.yml`; CI and Release own separate responsibilities.
- Update repository and package READMEs so they describe Bun 1.4 verification and the independent tag flow instead of the removed Node/Deno matrix and Changesets workflow.
- Do not commit, push, tag, or publish as part of this implementation.
