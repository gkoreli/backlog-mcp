---
id: ADR 0139
type: adr
title: Bun runtime and native YAML
created_at: 2026-10-08T05:21:49.697Z
updated_at: 2026-10-08T05:21:49.723Z
status: accepted
extends: 
  - ADR 0134
  - ADR 0136
description: "Adopts Bun 1.4.2 for installation, workspace scripts, runtime entrypoints and tests. Uses Bun native YAML through one injected codec and shared Markdown framing, preserving human document bytes on reads and removing the former gray-matter parser dependency."
---
# Bun runtime and native YAML

## Context

The maintainer requested Bun 1.4.2 and Bun's native YAML capability. The existing workspace uses pnpm and Node scripts, and gray-matter appears across core, storage, resources and HTTP. Runtime-specific parsing in core violates dependency direction and duplicates document framing.

## Decision

### R1. Bun owns the local toolchain

Pin Bun 1.4.2 in package-manager and development configuration. Use Bun workspace installation with a committed bun.lock, Bun runtime entrypoints, and Bun-driven build/typecheck/Vitest scripts. Preserve Vitest's existing memfs isolation rather than rewriting the unit suites. Node may remain in CI solely where npm trusted publishing tooling requires it; it is not the application runtime.

### R2. One injected YAML capability

Core owns a minimal parse/stringify codec contract and pure Markdown delimiter framing. Infrastructure's `storage/local/bun-yaml-codec.ts` is the sole owner of Bun.YAML. Discovery and migration receive that capability explicitly; local storage/resources/HTTP use the same framing. Remove production gray-matter use and its runtime dependency. No fallback parser hides Bun errors.

### R3. Preserve bytes and expose semantic differences

Native reads retain exact Markdown bytes and body content. YAML frontmatter must be a mapping; unterminated delimiters, malformed YAML, unsupported cyclic values and non-mapping payloads are explicit failures. Bun YAML follows YAML 1.2: dates and explicit binary values project as strings rather than the prior parser's Date/Uint8Array values. Authored files are not rewritten just to migrate the parser.

### R4. Scoped engineering-rule amendments

This supersedes ADR 0134 R6.1 only for its pnpm invocation wording: required workspace build, typecheck and unit tests run through Bun. It supersedes R6.4's gray-matter reader wording with the actual Bun YAML codec and Markdown framing. Under R8 the Bun built-in YAML API replaces gray-matter; bun-types is a pinned development type dependency, not a server package. Existing architecture invariants and shrinking import allowlists remain binding.

## Engineering plan

Migrate workspace manifests, lock/configuration, entrypoints and maintained guides. Replace parser imports with one framing owner and injected codec. Verify native-edited canonical documents remain manageable through structural metadata comparison (ADR 0113.4). Run the existing Vitest/memfs suites under actual Bun, actual built CLI/MCP processes and malformed native YAML probes.

## Consequences

Runtime, parser and package-manager contracts become explicit. YAML 1.2 typing differs from the previous parser; diagnostics and focused regressions make that difference reviewable. There is no forced corpus rewrite or scope expansion to local-home selection.

## References

- [Bun 1.4.2 release](https://bun.sh/blog/bun-v1.4.2)
- [Native YAML](https://bun.com/docs/runtime/yaml)
- [Workspaces](https://bun.com/docs/pm/workspaces)

## Validation

Implemented on 2026-10-07. Bun 1.4.2 owns the checked-in package-manager,
workspace lockfile, mise pin, scripts, CLI/daemon shebangs and CI build/test
commands. Retired pnpm lock/workspace files are removed. The bridge explicitly
runs mcp-remote through the invoking Bun executable; maintained subprocess
scripts use the same runtime. Evaluation metadata identifies Bun separately
from its Node-compatible process version. No package version changes.

All production and fixture gray-matter imports and its dependency are removed.
`core/markdown-frontmatter.ts` owns delimiter framing and supported metadata;
`storage/local/bun-yaml-codec.ts` alone calls Bun.YAML. Core discovery/migration
receive the consumer-owned codec. Storage, resources and HTTP use the same
framing. The shared canonical metadata policy prevents YAML typography from
becoming a separate adoption rule. Raw body/BOM/CRLF and later delimiters have
focused regressions; cyclic/non-finite or unsupported data fail before managed
publication. Native dates/binary values are explicitly tested as strings.

### Test-runner evidence

Vitest 2's relative mock importer recognized Node stack frames but missed Bun's
`at mock` frame, so mocked modules silently resolved to their real implementations.
Vitest 4.1.10 recognizes that frame; it is pinned as a development dependency.
The global memfs adapter now exposes both named exports and `default: fs` for
ESM consumers. It remains the existing memfs implementation.

Two previous search tests loaded a real embedding model/cache despite the unit-
only rule. They now mock the external feature-extraction boundary with known
384-dimensional normalized vectors. Actual Orama indexing, hybrid retrieval,
persistence and cold-process write behavior remain under test, including two
independent model-pipeline initializations. These tests establish retrieval
contracts rather than pretrained model quality; no model download is required.

### Acceptance

Actual Bun workspace build/typecheck and unit suites pass: 1,898 passing tests,
one pre-existing expected-failure case and two pre-existing skips. Architecture
import exception lists remain empty. Frozen offline installation passed using
genuine cached package contents; normal CI installation still requires registry
access and was not exercised in this restricted environment.

`bun pm pack` produced version 0.77.0 with the Bun engine requirement, private
workspace development references rewritten to versions, no private runtime
package dependencies and the exact maintained README. The temporary tarball and
package README were removed. No publication was performed.

Actual built CLI/MCP and cold HTTP/MCP checks are recorded in ADR 0113.4. The
managed native-edit compatibility action passed against real local storage.
OS watcher admission and real pretrained embedding inference were not validated:
this environment rejects FSEvents streams, and unit tests inject their external
boundaries. Native YAML duplicate-key strict linting remains unavailable through
Bun's current parse API; there is no second parser or silent fallback.
