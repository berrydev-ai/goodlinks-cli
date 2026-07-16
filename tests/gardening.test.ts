import assert from "node:assert/strict";
import test from "node:test";

import { links } from "./fixtures.js";
import { runCli, startApiServer } from "./helpers.js";

test("user can inspect tag and domain statistics across every page", async (t) => {
  const api = await startApiServer((request, response) => {
    const offset = Number(request.url.searchParams.get("offset") ?? 0);
    const data = offset === 0 ? links.slice(0, 2) : links.slice(2);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data, hasMore: offset === 0 }));
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const tags = await runCli([...global, "tags", "--json"]);
  const domains = await runCli([
    ...global,
    "urls",
    "--min-count",
    "2",
    "--json",
  ]);
  const urls = await runCli([...global, "urls", "--urls"]);

  assert.equal(tags.exitCode, 0, tags.stderr);
  assert.equal(domains.exitCode, 0, domains.stderr);
  assert.equal(urls.exitCode, 0, urls.stderr);
  assert.deepEqual(JSON.parse(tags.stdout), [
    { tag: "technology", count: 2 },
    { tag: "design", count: 1 },
  ]);
  assert.deepEqual(JSON.parse(domains.stdout), [
    { domain: "example.com", count: 2 },
  ]);
  assert.equal(
    urls.stdout,
    links.map((link) => link.url).join("\n") + "\n",
  );
  assert.equal(api.requests.every((request) => request.url.searchParams.get("limit") === "1000"), true);
});

test("user can preview domain tagging and safely remove newer duplicates", async (t) => {
  const duplicate = {
    ...links[0],
    id: "duplicate",
    title: "Newer duplicate",
    addedAt: "2025-02-01T00:00:00Z",
  };
  const collection = [...links, duplicate];
  const api = await startApiServer((request, response) => {
    if (request.method === "DELETE") {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.method === "PATCH") {
      response.end(JSON.stringify(links[0]));
      return;
    }
    response.end(JSON.stringify({ data: collection, hasMore: false }));
  });
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const preview = await runCli([
    ...global,
    "tag-domain",
    "--domain",
    "example.com",
    "--tag",
    "news",
    "--dry-run",
  ]);
  assert.equal(preview.exitCode, 0, preview.stderr);
  assert.match(preview.stdout, /would add tag 'news' to 3 link\(s\)/);
  assert.equal(api.requests.filter((request) => request.method === "PATCH").length, 0);

  const tagged = await runCli([
    ...global,
    "tag-domain",
    "--domain",
    "example.com",
    "--tag",
    "news",
  ]);
  assert.equal(tagged.exitCode, 0, tagged.stderr);
  assert.equal(api.requests.filter((request) => request.method === "PATCH").length, 3);
  assert.equal(
    api.requests.filter((request) => request.method === "PATCH")[0]?.url.pathname,
    "/api/v1/links/one",
  );
  assert.deepEqual(
    api.requests.filter((request) => request.method === "PATCH")[0]?.body,
    { addedTags: ["news"] },
  );

  const report = await runCli([...global, "dedupe", "--json"]);
  assert.equal(report.exitCode, 0, report.stderr);
  assert.deepEqual(JSON.parse(report.stdout), [
    {
      url: "https://example.com/one",
      copies: [
        { id: "one", title: "One", addedAt: "2025-01-01T00:00:00Z" },
        {
          id: "duplicate",
          title: "Newer duplicate",
          addedAt: "2025-02-01T00:00:00Z",
        },
      ],
    },
  ]);
  assert.equal(api.requests.filter((request) => request.method === "DELETE").length, 0);

  const deleted = await runCli([...global, "dedupe", "--delete"]);
  assert.equal(deleted.exitCode, 0, deleted.stderr);
  assert.match(deleted.stdout, /deleted 1 duplicate link\(s\)/);
  const deleteRequest = api.requests.find((request) => request.method === "DELETE");
  assert.deepEqual(deleteRequest?.url.searchParams.getAll("id"), ["duplicate"]);
});

test("user can find and tag dead links with offline and HTTP reasons", async (t) => {
  let apiBaseUrl = "";
  const api = await startApiServer((request, response) => {
    if (request.method === "HEAD") {
      response.statusCode = request.url.pathname.endsWith("/gone") ? 404 : 200;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.method === "PATCH") {
      response.end(JSON.stringify({}));
      return;
    }
    response.end(
      JSON.stringify({
        data: [
          { ...links[0], id: "gone", url: `${apiBaseUrl}/gone`, wordCount: 0 },
          { ...links[1], id: "ok", url: `${apiBaseUrl}/ok`, wordCount: 500 },
          {
            ...links[1],
            id: "unknown",
            url: `${apiBaseUrl}/unknown`,
            wordCount: null,
          },
        ],
        hasMore: false,
      }),
    );
  });
  apiBaseUrl = api.baseUrl;
  t.after(api.close);
  const global = ["--base-url", api.baseUrl];

  const report = await runCli([
    ...global,
    "dead-links",
    "--all",
    "--dry-run",
    "--json",
    "--workers",
    "2",
    "--timeout",
    "2",
  ]);
  assert.equal(report.exitCode, 0, report.stderr);
  assert.deepEqual(JSON.parse(report.stdout), [
    {
      id: "gone",
      url: `${api.baseUrl}/gone`,
      title: "One",
      reasons: ["unavailable offline (word count: 0)", "HTTP 404"],
      newTags: ["offline-unavailable", "http-404"],
    },
  ]);
  assert.equal(api.requests.filter((request) => request.method === "PATCH").length, 0);

  const apply = await runCli([
    ...global,
    "dead-links",
    "--all",
    "--workers",
    "2",
    "--timeout",
    "2",
  ]);
  assert.equal(apply.exitCode, 0, apply.stderr);
  const patchRequest = api.requests.find((request) => request.method === "PATCH");
  assert.equal(patchRequest?.url.pathname, "/api/v1/links/gone");
  assert.deepEqual(patchRequest?.body, {
    addedTags: ["offline-unavailable", "http-404"],
  });
});

test("user can preview and apply Claude tags chosen from existing tags", async (t) => {
  const anthropic = await startApiServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url.pathname, "/v1/messages");
    assert.equal(request.headers["x-api-key"], "anthropic-test-key");
    assert.match(JSON.stringify(request.body), /design, technology/);
    assert.match(JSON.stringify(request.body), /Article about design systems/);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ content: [{ type: "text", text: "design" }] }),
    );
  });
  t.after(anthropic.close);

  const api = await startApiServer((request, response) => {
    if (request.url.pathname === "/api/v1/tags") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(["design", "technology"]));
      return;
    }
    if (request.url.pathname.endsWith("/content")) {
      response.setHeader("content-type", "text/plain");
      response.end("Article about design systems.");
      return;
    }
    response.setHeader("content-type", "application/json");
    if (request.method === "PATCH") {
      response.end(JSON.stringify({}));
      return;
    }
    response.end(JSON.stringify({ data: [links[0]], hasMore: false }));
  });
  t.after(api.close);
  const environment = {
    ANTHROPIC_API_KEY: "anthropic-test-key",
    ANTHROPIC_BASE_URL: new URL("/v1", apiToOrigin(anthropic.baseUrl)).toString().replace(/\/$/, ""),
  };
  const global = ["--base-url", api.baseUrl];

  const preview = await runCli([...global, "auto-tag", "--json"], environment);
  assert.equal(preview.exitCode, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout), [
    {
      id: "one",
      url: "https://example.com/one",
      title: "One",
      suggestedTag: "design",
      tagsToAdd: ["claude-auto", "design"],
    },
  ]);
  assert.equal(api.requests.filter((request) => request.method === "PATCH").length, 0);

  const apply = await runCli([...global, "auto-tag"], environment);
  assert.equal(apply.exitCode, 0, apply.stderr);
  const patchRequest = api.requests.find((request) => request.method === "PATCH");
  assert.deepEqual(patchRequest?.body, {
    addedTags: ["claude-auto", "design"],
  });
});

const apiToOrigin = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
};
