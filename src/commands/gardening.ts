import { InvalidArgumentError, Option, type Command } from "commander";

import { createGoodLinksClient } from "../client.js";
import { resolveToken } from "../config.js";
import { domainOf, fetchAllLinks } from "../goodlinks.js";
import { writeJson, writeText } from "../output.js";
import type { ApiCommandGroups } from "./api.js";

type GlobalOptions = { baseUrl: string; token?: string };

/** Registers README-compatible GoodLinks collection commands. */
export const registerGardeningCommands = (
  program: Command,
  groups: ApiCommandGroups,
): void => {
  groups.tags
    .option("--json", "Emit tag statistics as JSON")
    .action(async (options: { json?: boolean }) => {
      const links = await fetchAllLinks(await clientFor(program));
      const counts = new Map<string, number>();
      for (const link of links) {
        for (const tag of link.tags ?? []) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
      const rows = [...counts].map(([tag, count]) => ({ tag, count }));
      rows.sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
      if (options.json) {
        writeJson(rows);
        return;
      }
      writeText(table(rows, "Tag", "tag"));
    });

  program
    .command("urls")
    .description("Show saved URL and domain statistics")
    .option("--urls", "Print every URL, one per line")
    .option("--min-count <number>", "Minimum domain count", integer, 2)
    .option("--json", "Emit domain statistics as JSON")
    .action(
      async (options: { json?: boolean; minCount: number; urls?: boolean }) => {
        const links = await fetchAllLinks(await clientFor(program));
        if (options.urls) {
          writeText(links.map((link) => link.url).filter(Boolean).join("\n"));
          return;
        }
        const counts = new Map<string, number>();
        for (const link of links) {
          const domain = domainOf(link.url);
          if (domain) {
            counts.set(domain, (counts.get(domain) ?? 0) + 1);
          }
        }
        const rows = [...counts]
          .filter(([, count]) => count >= options.minCount)
          .map(([domain, count]) => ({ domain, count }));
        rows.sort(
          (left, right) =>
            right.count - left.count || left.domain.localeCompare(right.domain),
        );
        if (options.json) {
          writeJson(rows);
          return;
        }
        writeText(table(rows, "Domain", "domain"));
      },
    );

  program
    .command("tag-domain")
    .description("Tag links from one domain and its subdomains")
    .requiredOption("--domain <domain>", "Root domain to match")
    .requiredOption("--tag <tag>", "Tag to add")
    .option("--dry-run", "Preview changes without updating links")
    .action(
      async (options: { domain: string; dryRun?: boolean; tag: string }) => {
        const client = await clientFor(program);
        const links = await fetchAllLinks(client);
        const target = options.domain.toLowerCase().replace(/^www\./, "");
        const matches = links.filter((link) => {
          const domain = domainOf(link.url);
          return (
            (domain === target || domain.endsWith(`.${target}`)) &&
            !(link.tags ?? []).includes(options.tag)
          );
        });
        if (options.dryRun) {
          writeText(
            `${matches.map((link) => `${link.title ?? "Untitled"}\n  ${link.url}`).join("\n")}\n\n[dry-run] would add tag '${options.tag}' to ${matches.length} link(s).`,
          );
          return;
        }
        for (const link of matches) {
          await client.request("PATCH", `/links/${encodeURIComponent(link.id)}`, {
            body: { addedTags: [options.tag] },
          });
        }
        writeText(`added tag '${options.tag}' to ${matches.length} link(s).`);
      },
    );

  program
    .command("dedupe")
    .description("Find or remove links with identical URLs")
    .option("--delete", "Delete newer copies, keeping the oldest")
    .option("--json", "Emit duplicate groups as JSON and make no changes")
    .action(async (options: { delete?: boolean; json?: boolean }) => {
      const client = await clientFor(program);
      const links = await fetchAllLinks(client);
      const byUrl = new Map<string, typeof links>();
      for (const link of links) {
        const url = link.url.trim();
        if (url) {
          byUrl.set(url, [...(byUrl.get(url) ?? []), link]);
        }
      }
      const groups = [...byUrl]
        .filter(([, copies]) => copies.length > 1)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([url, copies]) => ({
          url,
          copies: [...copies].sort((left, right) =>
            left.addedAt.localeCompare(right.addedAt),
          ),
        }));
      const report = groups.map((group) => ({
        url: group.url,
        copies: group.copies.map(({ id, title, addedAt }) => ({
          id,
          title,
          addedAt,
        })),
      }));
      if (options.json) {
        writeJson(report);
        return;
      }
      if (groups.length === 0) {
        writeText("No duplicate URLs found.");
        return;
      }
      if (!options.delete) {
        writeText(
          `${formatDuplicateReport(report)}\n\nRun with --delete to remove newer copies.`,
        );
        return;
      }
      const duplicateIds = groups.flatMap((group) =>
        group.copies.slice(1).map((link) => link.id),
      );
      await client.request("DELETE", "/links", {
        query: { id: duplicateIds },
        response: "void",
      });
      writeText(`deleted ${duplicateIds.length} duplicate link(s).`);
    });

  program
    .command("dead-links")
    .description("Find and tag links that are unavailable")
    .addOption(new Option("--tag <tag>", "Check links with this tag").conflicts("all"))
    .addOption(new Option("--all", "Check every link").conflicts("tag"))
    .option("--unread", "Check only unread links")
    .option("--untagged", "Check only untagged links")
    .option("--timeout <seconds>", "HTTP timeout per URL", positiveInteger, 30)
    .option("--workers <number>", "Parallel HTTP probes", positiveInteger, 10)
    .option("--dry-run", "Report tags without updating links")
    .option("--json", "Emit results as JSON and make no changes")
    .action(
      async (options: {
        all?: boolean;
        dryRun?: boolean;
        json?: boolean;
        tag?: string;
        timeout: number;
        unread?: boolean;
        untagged?: boolean;
        workers: number;
      }) => {
        if (!options.all && !options.tag) {
          throw new InvalidArgumentError("Pass --tag <tag> or --all");
        }
        const client = await clientFor(program);
        let links = await fetchAllLinks(client);
        if (options.tag) {
          links = links.filter((link) => (link.tags ?? []).includes(options.tag!));
        }
        if (options.unread) {
          links = links.filter((link) => link.readAt === null);
        }
        if (options.untagged) {
          links = links.filter((link) => !link.tags?.length);
        }

        const probes = await mapConcurrent(links, options.workers, async (link) => ({
          id: link.id,
          result: await probeUrl(link.url, options.timeout),
        }));
        const probeById = new Map(probes.map(({ id, result }) => [id, result]));
        const dead = links.flatMap((link) => {
          const probe = probeById.get(link.id) ?? { disposition: "ok" as const };
          const reasons: string[] = [];
          const newTags: string[] = [];
          if (link.wordCount === 0) {
            reasons.push("unavailable offline (word count: 0)");
            addMissingTag(link.tags, newTags, "offline-unavailable");
          }
          if (probe.disposition === "http") {
            reasons.push(`HTTP ${probe.status}`);
            addMissingTag(link.tags, newTags, `http-${probe.status}`);
          } else if (probe.disposition === "timeout") {
            reasons.push("connection timed out");
            addMissingTag(link.tags, newTags, "http-timeout");
          } else if (probe.disposition === "error") {
            reasons.push("connection error");
            addMissingTag(link.tags, newTags, "http-error");
          }
          return reasons.length === 0
            ? []
            : [
                {
                  id: link.id,
                  url: link.url,
                  title: link.title,
                  reasons,
                  newTags,
                },
              ];
        });
        if (options.json) {
          writeJson(dead);
          return;
        }
        if (dead.length === 0) {
          writeText("No dead links found.");
          return;
        }
        if (options.dryRun) {
          writeText(
            `${formatDeadLinks(dead)}\n\n[dry-run] would tag ${dead.length} dead link(s).`,
          );
          return;
        }
        let tagged = 0;
        for (const entry of dead) {
          if (entry.newTags.length === 0) {
            continue;
          }
          await client.request("PATCH", `/links/${encodeURIComponent(entry.id)}`, {
            body: { addedTags: entry.newTags },
          });
          tagged += 1;
        }
        writeText(`tagged ${tagged} dead link(s).`);
      },
    );

  program
    .command("auto-tag")
    .description("Tag untagged links using Claude and existing tags")
    .option("--timeout <seconds>", "Fallback URL timeout", positiveInteger, 30)
    .option("--dry-run", "Preview tags without updating links")
    .option("--json", "Emit the tag plan as JSON and make no changes")
    .action(
      async (options: { dryRun?: boolean; json?: boolean; timeout: number }) => {
        const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
        if (!anthropicKey) {
          throw new Error("ANTHROPIC_API_KEY is required for auto-tag");
        }
        const client = await clientFor(program);
        const availableTags = await client.request<string[]>("GET", "/tags");
        if (availableTags.length === 0) {
          writeText("No existing tags found; auto-tag cannot choose a tag.");
          return;
        }
        const links = await fetchAllLinks(client, "/lists/untagged");
        const plan: Array<{
          id: string;
          suggestedTag: string | null;
          tagsToAdd: string[];
          title: string | null;
          url: string;
        }> = [];

        for (const link of links) {
          const content = await linkContent(client, link.id, link.url, options.timeout);
          if (!content) {
            plan.push({
              id: link.id,
              url: link.url,
              title: link.title,
              suggestedTag: null,
              tagsToAdd: ["content-unavailable"],
            });
            continue;
          }
          const suggestedTag = await suggestTag(
            anthropicKey,
            content,
            availableTags,
          );
          if (suggestedTag) {
            plan.push({
              id: link.id,
              url: link.url,
              title: link.title,
              suggestedTag,
              tagsToAdd: ["claude-auto", suggestedTag],
            });
          }
        }
        if (options.json) {
          writeJson(plan);
          return;
        }
        if (options.dryRun) {
          writeText(
            `${plan.map((entry) => `${entry.title ?? "Untitled"}: ${entry.tagsToAdd.join(", ")}`).join("\n")}\n\n[dry-run] would tag ${plan.length} link(s).`,
          );
          return;
        }
        for (const entry of plan) {
          await client.request("PATCH", `/links/${encodeURIComponent(entry.id)}`, {
            body: { addedTags: entry.tagsToAdd },
          });
        }
        writeText(`tagged ${plan.length} link(s).`);
      },
    );
};

const clientFor = async (program: Command) => {
  const options = program.opts<GlobalOptions>();
  return createGoodLinksClient(options.baseUrl, await resolveToken(options.token));
};

const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("Expected a non-negative integer");
  }
  return parsed;
};

const positiveInteger = (value: string): number => {
  const parsed = integer(value);
  if (parsed < 1) {
    throw new InvalidArgumentError("Expected a positive integer");
  }
  return parsed;
};

const table = <Row extends { count: number }>(
  rows: Row[],
  heading: string,
  key: keyof Row,
): string => {
  if (rows.length === 0) {
    return `No ${heading.toLowerCase()} results.`;
  }
  const width = Math.max(heading.length, ...rows.map((row) => String(row[key]).length));
  return [
    `${heading.padEnd(width)}  Count`,
    "-".repeat(width + 7),
    ...rows.map((row) => `${String(row[key]).padEnd(width)}  ${row.count}`),
  ].join("\n");
};

const formatDuplicateReport = (
  groups: Array<{
    copies: Array<{ addedAt: string; id: string; title: string | null }>;
    url: string;
  }>,
): string =>
  groups
    .map(
      (group) =>
        `${group.url}\n${group.copies
          .map(
            (copy, index) =>
              `  ${index === 0 ? "keep " : "dupe "}${copy.addedAt.slice(0, 10)} ${copy.title ?? "Untitled"}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");

type ProbeResult =
  | { disposition: "error" | "ok" | "timeout" }
  | { disposition: "http"; status: number };

const probeUrl = async (url: string, timeoutSeconds: number): Promise<ProbeResult> => {
  try {
    const signal = AbortSignal.timeout(timeoutSeconds * 1000);
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal });
    if (response.status === 405) {
      response = await fetch(url, { method: "GET", redirect: "follow", signal });
      await response.body?.cancel();
    }
    return response.status >= 400
      ? { disposition: "http", status: response.status }
      : { disposition: "ok" };
  } catch (error) {
    return error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
      ? { disposition: "timeout" }
      : { disposition: "error" };
  }
};

const mapConcurrent = async <Item, Result>(
  items: Item[],
  concurrency: number,
  worker: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await worker(item);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
};

const addMissingTag = (
  currentTags: string[] | null,
  newTags: string[],
  tag: string,
) => {
  if (!(currentTags ?? []).includes(tag)) {
    newTags.push(tag);
  }
};

const formatDeadLinks = (
  dead: Array<{
    newTags: string[];
    reasons: string[];
    title: string | null;
    url: string;
  }>,
): string =>
  dead
    .map(
      (entry) =>
        `${entry.title ?? "Untitled"}\n  ${entry.url}\n  ${entry.reasons.join(", ")}\n  tags: ${entry.newTags.join(", ")}`,
    )
    .join("\n\n");

const linkContent = async (
  client: Awaited<ReturnType<typeof clientFor>>,
  id: string,
  url: string,
  timeoutSeconds: number,
): Promise<string | undefined> => {
  try {
    const content = await client.request<string>(
      "GET",
      `/links/${encodeURIComponent(id)}/content`,
      { query: { format: "plaintext" }, response: "text" },
    );
    if (content.trim()) {
      return content;
    }
  } catch {
    // GoodLinks may not have cached content; direct fetch is the documented fallback.
  }
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "@berrydev-ai/goodlinks-cli" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    if (!response.ok) {
      return undefined;
    }
    const content = await response.text();
    return content.trim() || undefined;
  } catch {
    return undefined;
  }
};

const suggestTag = async (
  apiKey: string,
  content: string,
  availableTags: string[],
): Promise<string | undefined> => {
  const baseUrl = (
    process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1"
  ).replace(/\/$/, "");
  const sample = content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  const prompt = `analyze this article content and suggest the single best tag from the following list:\n${[...availableTags].sort().join(", ")}\n\nonly respond with the tag name itself, nothing else. if none fit well, respond with just the word "general" (even if not in the list).\n\narticle content:\n${sample}`;
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    content?: Array<{ text?: string; type?: string }>;
  };
  const suggestion = body.content?.find((block) => block.type === "text")?.text?.trim();
  return availableTags.find(
    (tag) => tag.toLowerCase() === suggestion?.toLowerCase(),
  );
};
