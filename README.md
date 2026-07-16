# `@berrydev-ai/goodlinks-cli`

TypeScript CLI for reading, managing, cleaning, and exporting a local
[GoodLinks](https://goodlinks.app/) library.

The CLI covers the complete [GoodLinks local API](https://goodlinks.app/api/),
the active features documented by
[`sulrich/goodlinks-utils`](https://github.com/sulrich/goodlinks-utils), and its
six documented backlog tools.

## Requirements

- Node.js 22 or newer.
- GoodLinks 3.2 or newer.
- GoodLinks running with **Settings → API** enabled.
- An API token from **Settings → API**.

The default API endpoint is `http://localhost:9428/api/v1`.

## Install

```bash
pnpm add --global @berrydev-ai/goodlinks-cli
```

Run without a global installation:

```bash
pnpm dlx @berrydev-ai/goodlinks-cli --help
```

The installed binary is `goodlinks`.

## Agent skill

Install the portable bootstrap into a supported agent:

```bash
npx skills add berrydev-ai/goodlinks-cli --list
npx skills add berrydev-ai/goodlinks-cli --skill goodlinks-cli
```

Load the detailed guide from the same npm version as the CLI:

```bash
goodlinks skills get core
```

Inspect bundled content directly:

```bash
goodlinks skills list
goodlinks skills get core --full
goodlinks skills path core
```

The guide inspects first and requires explicit approval immediately before every GoodLinks or filesystem mutation.

## Authentication

The CLI resolves a bearer token in ascending priority:

1. `~/.credentials/goodlinks-token.txt`
2. `GOODLINKS_API`
3. Global `--token <token>` option

Keep the token outside the repository. Treat it like a password.

```bash
export GOODLINKS_API="<token-from-goodlinks-settings>"
goodlinks links current
```

Use a different API endpoint by placing the global option before the command:

```bash
goodlinks --base-url http://localhost:9428/api/v1 links search --limit 10
```

## Direct API commands

Direct resource commands emit JSON, except content and highlight exports, which
preserve the API's text response.

### Links

```text
goodlinks links get <id>
goodlinks links get-url <url>
goodlinks links current
goodlinks links list <list> [filters]
goodlinks links search [filters]
goodlinks links add <url> [metadata]
goodlinks links edit <id> [metadata]
goodlinks links delete <ids...>
goodlinks links content <id> [--format html|plaintext|markdown]
```

Valid lists are `unread`, `read`, `starred`, `untagged`, `highlighted`, and
`all`.

Search supports every API filter:

- Repeated `--tag <tag>` filters.
- `--starred`, `--read`, `--tagged`, and `--highlighted` boolean filters.
- `--word-count-min` and `--word-count-max`.
- Added/read date boundaries.
- Every API sort order.
- `--limit` and `--offset` pagination.

Add a real page:

```bash
goodlinks links add https://goodlinks.app/api/ --tag goodlinks --starred
```

Edit metadata or tags:

```bash
goodlinks links edit <link-id> --read true --add-tag reviewed
goodlinks links edit <link-id> --remove-tag inbox
goodlinks links edit <link-id> --tag reference --tag goodlinks
goodlinks links edit <link-id> --clear-tags
```

`links delete` moves links to GoodLinks trash, where they can be recovered.

### Lists and tags

```bash
goodlinks lists
goodlinks tags list
```

`tags list` returns raw tag names. `tags` below returns usage counts.

### Highlights

```text
goodlinks highlights search [filters]
goodlinks highlights edit <highlight-id> --note <text>
goodlinks highlights edit <highlight-id> --clear-note
goodlinks highlights export <link-id>
```

Highlight search supports query, link, content, note, date, sort, limit, and
offset filters. GoodLinks does not expose highlight creation or deletion.

## Collection tools

### Tag statistics

```bash
goodlinks tags
goodlinks tags --json
```

Counts every tag across the complete paginated collection. Results sort by
frequency, then name.

### URL and domain statistics

```bash
goodlinks urls
goodlinks urls --min-count 5
goodlinks urls --urls
goodlinks urls --json
```

### Tag a domain

Subdomains match automatically. Preview before writing:

```bash
goodlinks tag-domain --domain github.com --tag development --dry-run
goodlinks tag-domain --domain github.com --tag development
```

### Find duplicates

Exact duplicate URLs are grouped. Deletion keeps the oldest saved copy.

```bash
goodlinks dedupe
goodlinks dedupe --json
goodlinks dedupe --delete
```

`--json` is report-only and never combines with deletion.

### Find dead links

```bash
goodlinks dead-links --tag development --dry-run
goodlinks dead-links --all --unread
goodlinks dead-links --all --untagged --json
```

The command checks GoodLinks offline availability and each URL's HTTP status.
It applies `offline-unavailable`, `http-<status>`, `http-timeout`, or
`http-error` tags. `--json` is report-only.

### Auto-tag with Claude

```bash
export ANTHROPIC_API_KEY="<anthropic-api-key>"
goodlinks auto-tag --dry-run
goodlinks auto-tag --json
goodlinks auto-tag
```

Claude Haiku chooses only from existing GoodLinks tags. Applied links also get
`claude-auto` for auditing. Content is read from GoodLinks first, then fetched
from the saved URL. Unavailable content receives `content-unavailable`.

## Backlog tools

The reference README listed these as ideas. This CLI implements all six.

### Remove or rename tags

```bash
goodlinks untag --tag inbox --domain github.com --dry-run --json
goodlinks untag --tag inbox --search "GoodLinks API" --dry-run
goodlinks retag --from inbox --to reading --dry-run --json
```

Remove `--dry-run` and `--json` to apply changes.

### Markdown report

```bash
goodlinks report > goodlinks-report.md
```

Includes totals, weekly saved/read counts, top domains, and top tags.

### Export

```bash
goodlinks export --format json > goodlinks.json
goodlinks export --format csv > goodlinks.csv
goodlinks export --format markdown > goodlinks.md
```

### Bulk tag

```bash
goodlinks bulk-tag --file domain-tags.yaml --dry-run --json
goodlinks bulk-tag --file domain-tags.json
```

The YAML or JSON file must be an object whose keys are domains and whose values
are one tag or a list of tags. Subdomains match their parent mapping.

### Stale unread links

```bash
goodlinks stale --days 90
goodlinks stale --days 90 --json
```

## Visualizations

```bash
goodlinks visualize
goodlinks visualize --output-dir goodlinks-stats --pretty
```

Standalone output:

```text
goodlinks-stats/
  data/goodlinks-data.json
  index.html
```

The dataset contains:

- `articles`: complete link rows, sorted by read date descending.
- `heatmap`: reads per calendar day.
- `tag_series`: saved links per tag and month.
- `domain_series`: saved links per domain and month.

The HTML page renders tag, activity, domain, and article views with Plotly.

Template override: run `goodlinks visualize --template-dir ./my-goodlinks-templates`.
The default templates ship in the package's templates directory. The custom
directory must contain index.html and the four goodlinks-*.html shortcode
templates.

## Live smoke test

Run the create/edit/get/delete check against the local GoodLinks server. It
requires `GOODLINKS_API`; the test deletes its uniquely named link in a finally
block.

```bash
GOODLINKS_API="<token-from-goodlinks-settings>" pnpm run smoke:live
```

### Hugo export

```bash
goodlinks visualize \
  --hugo-dir <hugo-project> \
  --page-bundle <content-page-bundle>
```

This copies `goodlinks-data.json` into the page bundle and installs:

- `goodlinks-plotly`
- `goodlinks-heatmap`
- `goodlinks-sunburst`
- `goodlinks-table`

under `layouts/shortcodes/`.

## AI-session use

Install or load the bundled skill before asking an agent to operate GoodLinks. It prefers JSON for inspection, uses dry-run/report modes before writes, protects credentials, and requires explicit approval immediately before each mutation.

Regenerate and check exact command metadata after changing the Commander tree:

```bash
pnpm run skill:generate
pnpm run skill:check
```

## Development

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run skill:check
pnpm run smoke:package
git diff --check
```

[Run the isolated agent skill forward tests](docs/testing/goodlinks-cli-agent-skill.md).

Tests run real CLI processes against controlled local HTTP servers. No private
implementation functions form part of the public package contract.

## Maintainer release

The npm package is public and published from the `main` branch. Keep npm
credentials and one-time passwords out of the repository.

Before each release:

```bash
pnpm install
pnpm run check
pnpm version patch       # or: minor / major
git push --follow-tags origin main
pnpm publish --access public --otp=<current-code>
```

Verify the published version:

```bash
npm view @berrydev-ai/goodlinks-cli version
```

Published npm versions are immutable. If `pnpm publish` reports `E403` because
the version was previously published, bump the version and publish again; do
not retry the same version.

## License

MIT
