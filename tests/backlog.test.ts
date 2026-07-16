import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { links } from "./fixtures.js";
import { runCli, startApiServer } from "./helpers.js";

test("user can preview and apply untag, retag, and domain mapping changes", async (t) => {
  const api = await startApiServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "PATCH") {
      response.end(JSON.stringify({}));
      return;
    }
    response.end(JSON.stringify({ data: links, hasMore: false }));
  });
  t.after(api.close);
  const directory = await mkdtemp(join(tmpdir(), "goodlinks-backlog-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const mappingFile = join(directory, "tags.yaml");
  await writeFile(
    mappingFile,
    "example.com:\n  - news\n  - reference\nother.example: other\n",
  );
  const global = ["--base-url", api.baseUrl];

  const untagPreview = await runCli([
    ...global,
    "untag",
    "--tag",
    "technology",
    "--domain",
    "example.com",
    "--dry-run",
    "--json",
  ]);
  assert.equal(untagPreview.exitCode, 0, untagPreview.stderr);
  assert.deepEqual(
    JSON.parse(untagPreview.stdout).map((entry: { id: string }) => entry.id),
    ["one", "two"],
  );

  const untag = await runCli([
    ...global,
    "untag",
    "--tag",
    "technology",
    "--domain",
    "example.com",
  ]);
  assert.equal(untag.exitCode, 0, untag.stderr);
  const untagWrites = api.requests.filter(
    (request) =>
      request.method === "PATCH" &&
      JSON.stringify(request.body) === JSON.stringify({ removedTags: ["technology"] }),
  );
  assert.equal(untagWrites.length, 2);

  const retagPreview = await runCli([
    ...global,
    "retag",
    "--from",
    "technology",
    "--to",
    "tech",
    "--dry-run",
    "--json",
  ]);
  assert.equal(retagPreview.exitCode, 0, retagPreview.stderr);
  assert.equal(JSON.parse(retagPreview.stdout).length, 2);

  const retag = await runCli([
    ...global,
    "retag",
    "--from",
    "technology",
    "--to",
    "tech",
  ]);
  assert.equal(retag.exitCode, 0, retag.stderr);
  const retagWrites = api.requests.filter(
    (request) =>
      request.method === "PATCH" &&
      JSON.stringify(request.body) ===
        JSON.stringify({ addedTags: ["tech"], removedTags: ["technology"] }),
  );
  assert.equal(retagWrites.length, 2);

  const bulkPreview = await runCli([
    ...global,
    "bulk-tag",
    "--file",
    mappingFile,
    "--dry-run",
    "--json",
  ]);
  assert.equal(bulkPreview.exitCode, 0, bulkPreview.stderr);
  assert.deepEqual(
    JSON.parse(bulkPreview.stdout).map(
      (entry: { id: string; tagsToAdd: string[] }) => [entry.id, entry.tagsToAdd],
    ),
    [
      ["one", ["news", "reference"]],
      ["two", ["news", "reference"]],
      ["three", ["other"]],
    ],
  );

  const bulk = await runCli([...global, "bulk-tag", "--file", mappingFile]);
  assert.equal(bulk.exitCode, 0, bulk.stderr);
  assert.match(bulk.stdout, /tagged 3 link\(s\)/);
});

test("user can report reading activity and find stale unread links", async (t) => {
  const api = await startApiServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: links, hasMore: false }));
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const report = await runCli([...global, "report"]);
  assert.equal(report.exitCode, 0, report.stderr);
  assert.match(report.stdout, /^# GoodLinks Reading Report/m);
  assert.match(report.stdout, /\| Total links \| 3 \|/);
  assert.match(report.stdout, /\| Read links \| 1 \|/);
  assert.match(report.stdout, /## Weekly activity/);
  assert.match(report.stdout, /## Top domains/);
  assert.match(report.stdout, /\| example\.com \| 2 \|/);
  assert.match(report.stdout, /## Top tags/);

  const stale = await runCli([
    ...global,
    "stale",
    "--days",
    "30",
    "--json",
  ]);
  assert.equal(stale.exitCode, 0, stale.stderr);
  assert.deepEqual(
    JSON.parse(stale.stdout).map((entry: { id: string }) => entry.id),
    ["one", "three"],
  );
});

test("user can export the complete collection as JSON, CSV, or Markdown", async (t) => {
  const api = await startApiServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: links, hasMore: false }));
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const json = await runCli([...global, "export", "--format", "json"]);
  const csv = await runCli([...global, "export", "--format", "csv"]);
  const markdown = await runCli([
    ...global,
    "export",
    "--format",
    "markdown",
  ]);

  for (const result of [json, csv, markdown]) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.deepEqual(JSON.parse(json.stdout), links);
  assert.match(
    csv.stdout,
    /^id,url,title,summary,author,tags,wordCount,starred,highlighted,addedAt,modifiedAt,readAt/m,
  );
  assert.match(csv.stdout, /one,https:\/\/example\.com\/one,One/);
  assert.match(markdown.stdout, /^# GoodLinks Export/m);
  assert.match(markdown.stdout, /## \[One\]\(https:\/\/example\.com\/one\)/);
  assert.match(markdown.stdout, /Tags: design, technology/);
});
