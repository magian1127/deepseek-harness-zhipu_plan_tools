# deepseek-harness-zhipu_plan_tools

**Zhipu MCP suite · DeepSeek Harness plugin**

[中文](README.md) · [English](README.en.md)

<p align="center">
  <img alt="version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-5965d8">
  <img alt="features search/reader/repo" src="https://img.shields.io/badge/features-search%20%C2%B7%20reader%20%C2%B7%20repo-4aa3ff">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-3b7a57">
</p>

Brings three Zhipu (GLM Coding Plan) MCP servers into DSH as **native providers and tools**:
the built-in `web_search` / `web_fetch` backends are replaced with Zhipu search and reader,
three `github_*` repository tools are added, and everything is toggled live from a settings
card. The vision MCP is researched and planned — see the [roadmap](#roadmap).

## Features

| Feature | Default | Notes |
| --- | --- | --- |
| Web search | on | Built-in `web_search` backend replaced with Zhipu search MCP (`web_search_prime`) |
| Web reader | on (follows web_fetch) | Built-in `web_fetch` backend replaced with Zhipu reader MCP (`webReader`, markdown output, better than local HTML conversion); DSH keeps `web_fetch` off by default — picks this up once enabled |
| Repo tools | off | Adds `github_search_doc`, `github_get_repo_structure`, `github_read_file`; enable them from the settings card when needed |
| Settings card | — | DSH settings → plugins: collapsible card with live toggles and credential reference, bilingual |

### How it works

- **Search/reader as provider swaps**: providers registered on the DSH `web` service;
  `cordis.patch.yml` points the `web` row's `searchProvider` / `fetchProvider` at this plugin.
  Model-facing tool names stay the same; only the backend changes.
- **Repo tools registered natively** via `ctx.tools.register` with prompt guidance, generic
  cards, and a 60s cooperative timeout. Malformed or stale historical arguments degrade to a generic card during replay; actual execution remains strictly validated.
- **Credentials**: single reference `ZAI_CODING_CN_API_KEY`, resolved in three tiers
  (DSH credentials service → environment → `~/.dsh/.credentials.yaml` direct read); the key
  never lands in config or logs.
- **Hot updates**: self-watching hot reload on the host artifact (edit `src/` →
  `npm run build` → live, no restart); settings apply live.

## Requirements

- DeepSeek Harness Web GUI, profile `web`, ≥ `0.1.0-rc.7` (settings card needs
  `exposeToClients` support in `settings.register`)
- Node.js `^22.19.0 || >=24.0.0`
- Zhipu GLM Coding Plan API key (`ZAI_CODING_CN_API_KEY`) — see
  [First use](#first-use-add-the-zai-coding-cn-provider)

## Install

Published (recommended):

```sh
dsh plugin --profile web add deepseek-harness-zhipu_plan_tools
# or, hot install while DSH is running:
npx -y deepseek-harness-zhipu_plan_tools install --profile web
```

Local source development:

```powershell
npm install
node bin/dsh-zhipu.mjs install --profile web --link <absolute project path>
```

The CLI picks the hot path automatically: when dsh-zh is in the live graph its manifest
reconcile mounts within seconds (refresh the page); otherwise a temporary hot row is
written with an honest hint. Check status:

```sh
npx -y deepseek-harness-zhipu_plan_tools status --profile web
```

## First use: add the zai-coding-cn provider

Before using this plugin, add the `zai-coding-cn` provider in DSH settings (one step, once
after install):

1. Open **DSH Settings → Models**;
2. In the provider dropdown pick **`zai-coding-cn`** (not the overseas `zai` — this plugin
   targets the Zhipu China endpoint `open.bigmodel.cn`);
3. Leave the **API key** empty (empty = environment authentication) and save.

After saving, DSH automatically uses the `ZAI_CODING_CN_API_KEY` parameter (recorded as
`apiKeyEnv: ZAI_CODING_CN_API_KEY` in config) as this provider's API key — the same
reference this plugin uses as its default `credentialRef`.

So you only need `ZAI_CODING_CN_API_KEY` to exist in the environment or
`~/.dsh/.credentials.yaml`; the plugin picks it up with zero extra config. If you store the
key under a different env var name, set `credentialRef` to that name in the settings card.

## Enabling web_fetch (reader)

DSH presets keep `web_fetch` off (`tool-web` row `fetch: false`); this plugin never flips
that switch. To use the reader, add to your profile patch
(`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- id: tool-web
  config:
    fetch: true
```

The `web_fetch` tool then appears and runs on the Zhipu backend. Without it, this feature
stays dormant.

## Settings and data

| Data | Storage |
| --- | --- |
| enabled / search / reader / zread / credentialRef | DSH `settings.yaml`, namespace `dsh-zhipu` |

- **Master switch `enabled`**: off = search/reader backends disabled, repo tools
  unregistered, prompts removed; the card stays.
- **`search` / `reader` disable, not revert**: when off, `web_search` / `web_fetch` report
  an unavailable backend; fully restoring the built-ins requires removing the
  `searchProvider` / `fetchProvider` pointers from the mount row.
- **`zread` unregisters cleanly**: off by default; enable it to register the three repo tools, or disable it to remove them immediately from the model tool catalog.
- No telemetry, no extra network endpoints beyond the official Zhipu MCP endpoints.

## Uninstall

```sh
dsh plugin --profile web remove deepseek-harness-zhipu_plan_tools
# or
npx -y deepseek-harness-zhipu_plan_tools remove --profile web
```

Removal clears the mount row and dependency and hot-unloads (no DSH restart); values under
`dsh-zhipu` in `settings.yaml` may remain and revive on reinstall.

## Development

```powershell
npm run typecheck   # all three tsconfigs
npm run build       # host (lib/) + client (lib/client.js) + CLI (bin/) + tests (.tsbuild/)
npm test            # build + node:test (22 cases)
npm run verify      # artifact presence + syntax + client bundle format + CLI usage smoke
node scripts/smoke-live.mjs   # live API smoke (needs credentials; search/reader/zread)
```

Hot iteration (no DSH restart): edit `src/` → `npm run build` → self-watching reload picks
it up; client changes auto-push under a `pnpm run dev:web` watcher, else refresh the page.

## Docs

- [Behavior](docs/behavior.md)
- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release](docs/release.md)

## Roadmap

- **Vision MCP**: the 8 official tools (`analyze_image`, `video_analysis`, OCR,
  UI-to-artifact, chart analysis, UI diff, …) as native GLM-4.6V `chat/completions` tools;
  endpoints, message structure, prompt sources, and model options (incl. `glm-4.6v-flash`)
  are archived in `docs/architecture.md`.
- MCP session reuse (save one handshake round trip per call).
- npm publish (package spec ready; `npm pack --dry-run` passes).

## License

MIT
