import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { links } from "./fixtures.js";
import { runCli, startApiServer } from "./helpers.js";

test("user can generate standalone and Hugo visualization assets", async (t) => {
  const api = await startApiServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: links, hasMore: false }));
  });
  t.after(api.close);
  const directory = await mkdtemp(join(tmpdir(), "goodlinks-visualize-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const output = join(directory, "standalone");
  const hugo = join(directory, "site");
  await mkdir(hugo);
  const global = ["--base-url", api.baseUrl];

  const standalone = await runCli([
    ...global,
    "visualize",
    "--output-dir",
    output,
    "--pretty",
  ]);
  assert.equal(standalone.exitCode, 0, standalone.stderr);
  const dataset = JSON.parse(
    await readFile(join(output, "data", "goodlinks-data.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(dataset), [
    "articles",
    "heatmap",
    "tag_series",
    "domain_series",
  ]);
  assert.deepEqual(dataset.articles.map((link: { id: string }) => link.id), [
    "two",
    "one",
    "three",
  ]);
  assert.deepEqual(dataset.heatmap, { "2025-01-03": 1 });
  assert.deepEqual(dataset.tag_series, {
    design: { "2025-01": 1 },
    technology: { "2025-01": 2 },
  });
  assert.deepEqual(dataset.domain_series, {
    "example.com": { "2025-01": 2 },
    "other.example": { "2025-01": 1 },
  });
  const html = await readFile(join(output, "index.html"), "utf8");
  assert.match(html, /data\/goodlinks-data\.json/);
  assert.match(html, /Plotly/);
  assert.match(html, /type:"heatmap"/);
  assert.match(html, /type:"sunburst"/);
  assert.match(html, /article-filter/);
  assert.match(html, /article-sort/);

  const customTemplates = await mkdtemp(join(tmpdir(), "goodlinks-templates-"));
  t.after(() => rm(customTemplates, { force: true, recursive: true }));
  await writeFile(join(customTemplates, "index.html"), "custom index\n");
  for (const name of [
    "goodlinks-plotly",
    "goodlinks-heatmap",
    "goodlinks-sunburst",
    "goodlinks-table",
  ]) {
    await writeFile(join(customTemplates, `${name}.html`), `custom ${name}\n`);
  }
  const custom = await runCli([
    ...global,
    "visualize",
    "--output-dir",
    join(directory, "custom"),
    "--template-dir",
    customTemplates,
    "--hugo-dir",
    hugo,
    "--page-bundle",
    "content/posts/custom-stats",
  ]);
  assert.equal(custom.exitCode, 0, custom.stderr);
  assert.equal(
    await readFile(join(directory, "custom", "index.html"), "utf8"),
    "custom index\n",
  );
  assert.equal(
    await readFile(
      join(hugo, "layouts", "shortcodes", "goodlinks-table.html"),
      "utf8",
    ),
    "custom goodlinks-table\n",
  );

  const hugoResult = await runCli([
    ...global,
    "visualize",
    "--output-dir",
    join(directory, "hugo-standalone"),
    "--hugo-dir",
    hugo,
    "--page-bundle",
    "content/posts/reading-stats",
  ]);
  assert.equal(hugoResult.exitCode, 0, hugoResult.stderr);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(hugo, "content/posts/reading-stats/goodlinks-data.json"),
        "utf8",
      ),
    ).heatmap,
    { "2025-01-03": 1 },
  );
  for (const name of [
    "goodlinks-plotly",
    "goodlinks-heatmap",
    "goodlinks-sunburst",
    "goodlinks-table",
  ]) {
    const shortcode = await readFile(
      join(hugo, "layouts", "shortcodes", `${name}.html`),
      "utf8",
    );
    assert.match(shortcode, /goodlinks-data\.json/);
  }
});
