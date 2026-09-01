# deepseek-harness-zhipu_plan_tools

**Zhipu MCP suite · DeepSeek Harness plugin**

[中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="version 0.1.3" src="https://img.shields.io/badge/version-0.1.3-5965d8">
  <img alt="features search/reader/repo" src="https://img.shields.io/badge/features-search%20%C2%B7%20reader%20%C2%B7%20repo-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

Brings three Zhipu GLM Coding Plan MCP services into DSH as native providers and tools: it replaces the built-in `web_search` and `web_fetch` backends, and optionally adds three `github_*` repository tools. A bilingual settings card applies changes live.

## Features and settings order

Expand **Zhipu Tools** under **DSH Settings → Plugins → Plugin configuration**. The rows below follow the card from top to bottom:

| Setting | Plugin default | Summary |
| --- | --- | --- |
| Enable Zhipu tools | on | Master switch; off enters search/reader compatibility fallbacks and unregisters repo tools and related guidance while keeping the card |
| Web search (takes over `web_search`) | on | Routes search through Zhipu `web_search_prime` and replaces the model-visible built-in search guidance |
| Web reader (takes over `web_fetch`) | on | Routes reads through Zhipu `webReader`; DSH still keeps the `web_fetch` tool itself off by default |
| Repository tools | off | Adds `github_search_doc`, `github_get_repo_structure`, and `github_read_file` |
| Chinese prompts | off | Switches plugin-injected guidance and tool descriptions from the default English to Chinese; tool names stay unchanged |
| Credential reference | `ZAI_CODING_CN_API_KEY` | Stores only the credential reference name, never the API key |

The card starts collapsed and ends with Restore defaults / Discard changes / Save. Search and reader are provider swaps, so model-facing web tool names stay unchanged; repository tools are registered natively and disappear from the model catalog when disabled. The `web_search` shadow is never registered under the **minimal preset** (the "persistent shell + str_replace_editor" two-tool composition), preserving that preset's promise. See the [behavior contract](docs/behavior.md) for query guidance, data boundaries, and errors.

## Requirements

- DeepSeek Harness Web GUI, profile `web`, ≥ `0.1.2-alpha.1`
- Node.js `^22.19.0 || >=24.0.0`
- A Zhipu GLM Coding Plan API key referenced by `ZAI_CODING_CN_API_KEY` by default

## Install

Published package:

```sh
dsh plugin --profile web add deepseek-harness-zhipu_plan_tools
# Hot-install into a running DSH instance:
npx -y deepseek-harness-zhipu_plan_tools install --profile web
```

Local source development:

```powershell
npm install
node bin/dsh-zhipu.mjs install --profile web --link <project-path>
```

This package patch includes `web.config`, so it is not compatible with dsh-zh's simple manifest reconcile. The CLI uses this project's bridge/temporary-entry strategy; after it reports completion, confirm `status`, the live provider/tool registries, and the existing GUI:

```sh
npx -y deepseek-harness-zhipu_plan_tools status --profile web
```

## First use: add `zai-coding-cn`

Before calling the tools:

1. Open **DSH Settings → Models**.
2. Add the China-region provider **`zai-coding-cn`**, not the overseas `zai`.
3. Ensure `ZAI_CODING_CN_API_KEY` exists in the environment or `${DSH_HOME:-~/.dsh}/.credentials.yaml`.

The provider and this plugin then use the same credential reference. If your key uses a different environment-variable name, set that name as `credentialRef` in the plugin card. Resolution order and security guarantees are defined in [Credentials and data boundaries](docs/behavior.md#凭据与数据边界).

## Enable `web_fetch`

DSH normally keeps the `web_fetch` tool off. This plugin supplies its backend but does not change that independent switch. Enable it in the profile patch:

```yaml
- id: tool-web
  config:
    fetch: true
```

Once enabled, `web_fetch` automatically uses the Zhipu reader. See the authoritative [enablement boundary](docs/behavior.md#web_fetch-启用边界).

## Settings and data

The six fields shown above are stored in that same order in the `dsh-zhipu` namespace of DSH `settings.yaml` and apply live; the API key itself is never stored there. Switching `search`/`reader` off enters compatibility fallbacks at runtime (the DSH DeepSeek request shape via `DEEPSEEK_API_KEY`; a bounded HTTP(S) text fetch), without restarting DSH. The HTTP fallback validates URLs, follows same-origin redirects only, and caps transfer and decoded output; its exact limits and residual DNS-rebinding boundary are documented in the [behavior contract](docs/behavior.md), together with credential lookup, failure codes, and telemetry boundaries.

## Uninstall

```sh
dsh plugin --profile web remove deepseek-harness-zhipu_plan_tools
# or
npx -y deepseek-harness-zhipu_plan_tools remove --profile web
```

Removal clears the plugin's mount/dependency and hot-unloads it. Existing values under the `dsh-zhipu` settings namespace may remain for a later reinstall.

## Development

Use [Development](docs/development.md) for repository structure, hot paths, invariants, and test strategy. Use [Release](docs/release.md) for the complete pre-publish checklist. The common local checks are:

```powershell
npm run typecheck
npm run build
npm test
npm run verify
```

Do not restart DSH for development or verification; follow the documented hot path and refresh the existing GUI only when needed.

## Documentation index

- [Behavior contract](docs/behavior.md) — defaults, settings, credentials, boundaries, errors
- [Architecture](docs/architecture.md) — runtime structure, module contracts, decisions, research, roadmap
- [Development](docs/development.md) — repository layout, hot paths, invariants, tests
- [Troubleshooting](docs/troubleshooting.md) — symptom-driven diagnosis and runtime observation
- [Release](docs/release.md) — validation, version notes, npm publishing

## Roadmap

The technical roadmap is maintained in [Architecture](docs/architecture.md#技术路线图); release state belongs in [Release](docs/release.md).

## License

MIT
