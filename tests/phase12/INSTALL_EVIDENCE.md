# INSTALL_EVIDENCE — Phase 12 Desktop Profile

Date: 2026-08-24

Command (from Platform repo root):

```bash
dsh plugin --profile desktop add file:./electronics-agent-plugin
```

This machine's `pnpm` on PATH is v10 (store `v10`). The desktop profile was originally linked from store `v11`, so the first add failed with `ERR_PNPM_UNEXPECTED_STORE`. Retry with pnpm 11 (same store the profile already uses) succeeded. The original `~/.dsh/.credentials.yaml` was not kept in a modified state after a CLI schema probe.

## Install

| Check | Result |
|---|---|
| pnpm added `electronics-agent` | `file:…/electronics-agent-plugin` in `~/.dsh/profiles/desktop/package.json` |
| Bundle layer | `electronics-agent` is the last entry in `dsh.profile.bundles` |
| Materialized package | `~/.dsh/profiles/desktop/node_modules/electronics-agent` contains `src/index.js`, `src/present.js`, `skills/*.md` |

## Load / Harness discovery

`dsh --dump-config --profile desktop` ends with:

```yaml
# == electronics-agent
- id: electronics-agent
  name: electronics-agent
```

Full boot (desktop is the Web GUI profile) logged:

```text
[electronics-agent] plugin loaded
[electronics-agent] tools: part_research, import_extract, company_research
dsh web: http://127.0.0.1:18721
```

Excerpt: `tests/phase12/desktop-boot-excerpt.log`.

## Tools registered

`apply()` registers:

- `part_research` → `POST /v1/parts/research`
- `import_extract` → `POST /v1/import/extract`
- `company_research` → `POST /v1/companies/research`

No `confirmImport`. No `@electronics/dsh-*`.

## Skills loaded

Skills are **not** discovered by inserting a second `skill-filesystem` with `!!js require(...)` (Cordis interpolator has no `require`). The plugin `inject`s `["tools", "skills"]` and `ctx.skills.register()`s:

- `part-analysis`
- `import-analysis`
- `company-analysis`

All `user-invocable: true`. Bodies live in `electronics-agent-plugin/skills/`.

## CLI note (not a plugin defect)

Current `dsh-credentials-local` expects a flat `CREDENTIAL_REF: string` document. The GUI-managed `~/.dsh/.credentials.yaml` also has `version` / `refs` metadata, so a raw `dsh --profile desktop` boot can fail the credentials plugin **after** electronics-agent has already applied. Verification boot used `dsh --patch` pointing at a temporary flattened copy; the original credentials file was restored.

Desktop is a GUI (`dsh web`). One-shot user prompts in this evidence used the same plugin installed into the official `headless` profile (`dsh --profile headless "…"`), not the Phase 11 `DeepSeekHarness` SDK / `jsonrpc.cordis.yml` launcher.
