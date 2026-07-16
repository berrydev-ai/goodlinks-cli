import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runCli, startApiServer } from "./helpers.js";

const link = {
  id: "abc123",
  url: "https://example.com/article",
  title: "Example Article Title",
  summary: "This is a brief summary of the article.",
  author: "John Doe",
  tags: ["technology", "programming"],
  wordCount: 1250,
  starred: false,
  highlighted: false,
  addedAt: "2025-01-15T10:30:00Z",
  modifiedAt: "2025-01-15T10:30:00Z",
  readAt: null,
};

test("user can get a link by ID with bearer authentication", async (t) => {
  const api = await startApiServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url.pathname, "/api/v1/links/abc123");
    assert.equal(request.headers.authorization, "Bearer test-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(link));
  });
  t.after(api.close);

  const result = await runCli([
    "--base-url",
    api.baseUrl,
    "--token",
    "test-token",
    "links",
    "get",
    "abc123",
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), link);
});

test("CLI token overrides environment and credential-file tokens", async (t) => {
  const api = await startApiServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(link));
  });
  t.after(api.close);
  const home = await mkdtemp(join(tmpdir(), "goodlinks-auth-"));
  t.after(() => rm(home, { force: true, recursive: true }));
  await mkdir(join(home, ".credentials"));
  await writeFile(join(home, ".credentials", "goodlinks-token.txt"), "file-token\n");
  const command = ["--base-url", api.baseUrl, "links", "get", "abc123"];

  const fromFile = await runCli(command, { HOME: home, GOODLINKS_API: "" });
  const fromEnvironment = await runCli(command, {
    HOME: home,
    GOODLINKS_API: "environment-token",
  });
  const fromCli = await runCli(
    ["--base-url", api.baseUrl, "--token", "cli-token", "links", "get", "abc123"],
    { HOME: home, GOODLINKS_API: "environment-token" },
  );

  for (const result of [fromFile, fromEnvironment, fromCli]) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.deepEqual(
    api.requests.map((request) => request.headers.authorization),
    ["Bearer file-token", "Bearer environment-token", "Bearer cli-token"],
  );
});

test("user can read links through every documented lookup and filter", async (t) => {
  const api = await startApiServer((request, response) => {
    if (request.url.pathname.endsWith("/content")) {
      response.setHeader("content-type", "text/markdown");
      response.end("# Article content\n");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url.pathname.startsWith("/api/v1/lists/") ||
          request.url.searchParams.has("search")
          ? { data: [link], hasMore: false }
          : link,
      ),
    );
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const commands = [
    [...global, "links", "get-url", "https://example.com/article"],
    [...global, "links", "current"],
    [
      ...global,
      "links",
      "list",
      "starred",
      "--search",
      "programming",
      "--tag",
      "technology",
      "--tag",
      "programming",
      "--include-read",
      "--limit",
      "10",
      "--offset",
      "20",
    ],
    [
      ...global,
      "links",
      "search",
      "--search",
      "programming",
      "--tag",
      "technology",
      "--starred",
      "true",
      "--read",
      "false",
      "--tagged",
      "true",
      "--highlighted",
      "false",
      "--word-count-min",
      "100",
      "--word-count-max",
      "5000",
      "--added-after",
      "2025-01-01T00:00:00Z",
      "--added-before",
      "2025-01-31T23:59:59Z",
      "--read-after",
      "2025-01-02T00:00:00Z",
      "--read-before",
      "2025-01-30T23:59:59Z",
      "--sort",
      "longest",
      "--limit",
      "10",
      "--offset",
      "5",
    ],
    [
      ...global,
      "links",
      "content",
      "abc123",
      "--format",
      "markdown",
      "--no-auto-download",
    ],
  ];

  const results = [];
  for (const command of commands) {
    results.push(await runCli(command));
  }
  for (const result of results) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal(results.at(-1)?.stdout, "# Article content\n");

  assert.equal(api.requests[0]?.url.searchParams.get("url"), link.url);
  assert.equal(api.requests[1]?.url.pathname, "/api/v1/links/current");
  assert.deepEqual(api.requests[2]?.url.searchParams.getAll("tag"), [
    "technology",
    "programming",
  ]);
  assert.equal(api.requests[2]?.url.searchParams.get("includeRead"), "true");
  assert.deepEqual(api.requests[3]?.url.searchParams.getAll("tag"), [
    "technology",
  ]);
  assert.deepEqual(
    Object.fromEntries(api.requests[3]?.url.searchParams ?? []),
    {
      search: "programming",
      tag: "technology",
      starred: "true",
      read: "false",
      tagged: "true",
      highlighted: "false",
      wordCountMin: "100",
      wordCountMax: "5000",
      addedAfter: "2025-01-01T00:00:00Z",
      addedBefore: "2025-01-31T23:59:59Z",
      readAfter: "2025-01-02T00:00:00Z",
      readBefore: "2025-01-30T23:59:59Z",
      sort: "longest",
      limit: "10",
      offset: "5",
    },
  );
  assert.equal(api.requests[4]?.url.searchParams.get("format"), "markdown");
  assert.equal(api.requests[4]?.url.searchParams.get("autoDownload"), "false");
});

test("user can add, edit, and delete links", async (t) => {
  const api = await startApiServer((request, response) => {
    if (request.method === "DELETE") {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(link));
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const add = await runCli([
    ...global,
    "links",
    "add",
    "https://example.com/article",
    "--title",
    "Example Article",
    "--summary",
    "A useful article.",
    "--tag",
    "technology",
    "--tag",
    "programming",
    "--read",
    "--starred",
    "--added-at",
    "2025-01-15T10:30:00Z",
  ]);
  const edit = await runCli([
    ...global,
    "links",
    "edit",
    "abc123",
    "--title",
    "Updated Article",
    "--summary",
    "Updated summary.",
    "--starred",
    "true",
    "--read",
    "false",
    "--add-tag",
    "design",
    "--remove-tag",
    "programming",
  ]);
  const replaceTags = await runCli([
    ...global,
    "links",
    "edit",
    "abc123",
    "--tag",
    "design",
    "--tag",
    "ui",
  ]);
  const remove = await runCli([
    ...global,
    "links",
    "delete",
    "abc123",
    "def456",
  ]);

  for (const result of [add, edit, replaceTags, remove]) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.deepEqual(api.requests[0]?.body, {
    url: "https://example.com/article",
    title: "Example Article",
    summary: "A useful article.",
    tags: ["technology", "programming"],
    read: true,
    starred: true,
    addedAt: "2025-01-15T10:30:00Z",
  });
  assert.deepEqual(api.requests[1]?.body, {
    title: "Updated Article",
    summary: "Updated summary.",
    starred: true,
    read: false,
    addedTags: ["design"],
    removedTags: ["programming"],
  });
  assert.deepEqual(api.requests[2]?.body, { tags: ["design", "ui"] });
  assert.deepEqual(api.requests[3]?.url.searchParams.getAll("id"), [
    "abc123",
    "def456",
  ]);
  assert.deepEqual(JSON.parse(remove.stdout), {
    deleted: ["abc123", "def456"],
  });
});

test("user can read lists and tags and manage highlights", async (t) => {
  const highlight = {
    id: "highlight123",
    linkID: "abc123",
    content: "This is an important quote from the article.",
    markdownContent: "This is an **important** quote from the article.",
    note: "Key insight",
    createdAt: "2025-01-15T10:30:00Z",
  };
  const api = await startApiServer((request, response) => {
    if (request.url.pathname.endsWith("/highlights/export")) {
      response.setHeader("content-type", "text/markdown");
      response.end("# Exported highlights\n");
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.url.pathname === "/api/v1/lists") {
      response.end(JSON.stringify([{ id: "all", name: "All" }]));
      return;
    }
    if (request.url.pathname === "/api/v1/tags") {
      response.end(JSON.stringify(["design", "technology/programming"]));
      return;
    }
    response.end(
      JSON.stringify(
        request.method === "PATCH"
          ? { ...highlight, note: request.body && (request.body as { note: string }).note }
          : { data: [highlight], hasMore: false },
      ),
    );
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const lists = await runCli([...global, "lists"]);
  const tags = await runCli([...global, "tags", "list"]);
  const search = await runCli([
    ...global,
    "highlights",
    "search",
    "--query",
    "important",
    "--link-id",
    "abc123",
    "--content",
    "quote",
    "--note",
    "insight",
    "--created-after",
    "2025-01-01T00:00:00Z",
    "--created-before",
    "2025-01-31T23:59:59Z",
    "--sort",
    "oldest",
    "--limit",
    "10",
    "--offset",
    "5",
  ]);
  const edit = await runCli([
    ...global,
    "highlights",
    "edit",
    "highlight123",
    "--note",
    "Updated note",
  ]);
  const clear = await runCli([
    ...global,
    "highlights",
    "edit",
    "highlight123",
    "--clear-note",
  ]);
  const exported = await runCli([
    ...global,
    "highlights",
    "export",
    "abc123",
  ]);

  for (const result of [lists, tags, search, edit, clear, exported]) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.deepEqual(JSON.parse(lists.stdout), [{ id: "all", name: "All" }]);
  assert.deepEqual(JSON.parse(tags.stdout), ["design", "technology/programming"]);
  assert.deepEqual(
    Object.fromEntries(api.requests[2]?.url.searchParams ?? []),
    {
      q: "important",
      linkID: "abc123",
      content: "quote",
      note: "insight",
      createdAfter: "2025-01-01T00:00:00Z",
      createdBefore: "2025-01-31T23:59:59Z",
      sort: "oldest",
      limit: "10",
      offset: "5",
    },
  );
  assert.deepEqual(api.requests[3]?.body, { note: "Updated note" });
  assert.deepEqual(api.requests[4]?.body, { note: "" });
  assert.equal(exported.stdout, "# Exported highlights\n");
});
