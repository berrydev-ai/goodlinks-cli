import { readFile } from "node:fs/promises";

import { InvalidArgumentError, Option, type Command } from "commander";
import { parse } from "yaml";

import { createGoodLinksClient } from "../client.js";
import { resolveToken } from "../config.js";
import { domainOf, fetchAllLinks, type Link } from "../goodlinks.js";
import { writeJson, writeText } from "../output.js";

type GlobalOptions = { baseUrl: string; token?: string };

type TagPlan = {
  id: string;
  tagsToAdd?: string[];
  tagsToRemove?: string[];
  title: string | null;
  url: string;
};

/** Registers commands promoted from the reference project's backlog. */
export const registerBacklogCommands = (program: Command): void => {
  program
    .command("untag")
    .description("Remove a tag from links matching a domain or search")
    .requiredOption("--tag <tag>", "Tag to remove")
    .addOption(new Option("--domain <domain>", "Match a domain").conflicts("search"))
    .addOption(new Option("--search <text>", "Use GoodLinks search").conflicts("domain"))
    .option("--dry-run", "Preview changes")
    .option("--json", "Emit the plan as JSON and make no changes")
    .action(
      async (options: {
        domain?: string;
        dryRun?: boolean;
        json?: boolean;
        search?: string;
        tag: string;
      }) => {
        if (!options.domain && !options.search) {
          throw new InvalidArgumentError("Pass --domain or --search");
        }
        const client = await clientFor(program);
        let links = options.search
          ? await fetchAllLinks(client, "/links", { search: options.search })
          : await fetchAllLinks(client);
        if (options.domain) {
          const target = normalizeDomain(options.domain);
          links = links.filter((link) => matchesDomain(domainOf(link.url), target));
        }
        const plan: TagPlan[] = links
          .filter((link) => (link.tags ?? []).includes(options.tag))
          .map((link) => ({
            id: link.id,
            url: link.url,
            title: link.title,
            tagsToRemove: [options.tag],
          }));
        await applyPlan(client, plan, options, "removed tag", {
          removedTags: "tagsToRemove",
        });
      },
    );

  program
    .command("retag")
    .description("Rename a tag across the collection")
    .requiredOption("--from <tag>", "Existing tag")
    .requiredOption("--to <tag>", "Replacement tag")
    .option("--dry-run", "Preview changes")
    .option("--json", "Emit the plan as JSON and make no changes")
    .action(
      async (options: {
        dryRun?: boolean;
        from: string;
        json?: boolean;
        to: string;
      }) => {
        const client = await clientFor(program);
        const plan: TagPlan[] = (await fetchAllLinks(client))
          .filter((link) => (link.tags ?? []).includes(options.from))
          .map((link) => ({
            id: link.id,
            url: link.url,
            title: link.title,
            tagsToAdd: (link.tags ?? []).includes(options.to) ? [] : [options.to],
            tagsToRemove: [options.from],
          }));
        await applyPlan(client, plan, options, "retagged", {
          addedTags: "tagsToAdd",
          removedTags: "tagsToRemove",
        });
      },
    );

  program
    .command("bulk-tag")
    .description("Apply tags from a YAML or JSON domain mapping")
    .requiredOption("--file <path>", "YAML or JSON mapping file")
    .option("--dry-run", "Preview changes")
    .option("--json", "Emit the plan as JSON and make no changes")
    .action(
      async (options: {
        dryRun?: boolean;
        file: string;
        json?: boolean;
      }) => {
        const mapping = readMapping(await readFile(options.file, "utf8"));
        const client = await clientFor(program);
        const plan: TagPlan[] = (await fetchAllLinks(client)).flatMap((link) => {
          const domain = domainOf(link.url);
          const tags = [...mapping]
            .filter(([target]) => matchesDomain(domain, target))
            .flatMap(([, mappedTags]) => mappedTags)
            .filter((tag, index, all) => all.indexOf(tag) === index)
            .filter((tag) => !(link.tags ?? []).includes(tag));
          return tags.length === 0
            ? []
            : [
                {
                  id: link.id,
                  url: link.url,
                  title: link.title,
                  tagsToAdd: tags,
                },
              ];
        });
        await applyPlan(client, plan, options, "tagged", {
          addedTags: "tagsToAdd",
        });
      },
    );

  program
    .command("report")
    .description("Write a Markdown reading report")
    .action(async () => {
      writeText(readingReport(await fetchAllLinks(await clientFor(program))));
    });

  program
    .command("stale")
    .description("List unread links saved more than a given number of days ago")
    .requiredOption("--days <number>", "Minimum age in days", positiveInteger)
    .option("--json", "Emit stale links as JSON")
    .action(async (options: { days: number; json?: boolean }) => {
      const cutoff = Date.now() - options.days * 86_400_000;
      const stale = (await fetchAllLinks(await clientFor(program)))
        .filter((link) => link.readAt === null && Date.parse(link.addedAt) < cutoff)
        .sort((left, right) => left.addedAt.localeCompare(right.addedAt));
      if (options.json) {
        writeJson(stale);
        return;
      }
      writeText(
        stale.length === 0
          ? `No unread links older than ${options.days} days.`
          : stale
              .map(
                (link) =>
                  `${link.addedAt.slice(0, 10)}  ${link.title ?? "Untitled"}\n  ${link.url}`,
              )
              .join("\n"),
      );
    });

  program
    .command("export")
    .description("Export the complete collection")
    .addOption(
      new Option("--format <format>", "Export format")
        .choices(["json", "csv", "markdown"])
        .default("json"),
    )
    .action(async (options: { format: "csv" | "json" | "markdown" }) => {
      const links = await fetchAllLinks(await clientFor(program));
      if (options.format === "json") {
        writeJson(links);
      } else if (options.format === "csv") {
        writeText(csvExport(links));
      } else {
        writeText(markdownExport(links));
      }
    });
};

const clientFor = async (program: Command) => {
  const options = program.opts<GlobalOptions>();
  return createGoodLinksClient(options.baseUrl, await resolveToken(options.token));
};

const applyPlan = async (
  client: Awaited<ReturnType<typeof clientFor>>,
  plan: TagPlan[],
  options: { dryRun?: boolean; json?: boolean },
  verb: string,
  fields: Partial<Record<"addedTags" | "removedTags", keyof TagPlan>>,
) => {
  if (options.json) {
    writeJson(plan);
    return;
  }
  if (options.dryRun) {
    writeText(
      `${formatPlan(plan)}\n\n[dry-run] would update ${plan.length} link(s).`,
    );
    return;
  }
  for (const entry of plan) {
    const body = Object.fromEntries(
      Object.entries(fields).flatMap(([apiField, planField]) => {
        const value = entry[planField];
        return Array.isArray(value) && value.length > 0 ? [[apiField, value]] : [];
      }),
    );
    await client.request("PATCH", `/links/${encodeURIComponent(entry.id)}`, {
      body,
    });
  }
  writeText(`${verb} ${plan.length} link(s).`);
};

const normalizeDomain = (domain: string): string =>
  domain.toLowerCase().replace(/^www\./, "");

const matchesDomain = (domain: string, target: string): boolean =>
  domain === target || domain.endsWith(`.${target}`);

const readMapping = (contents: string): Map<string, string[]> => {
  const value = parse(contents) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidArgumentError("Mapping must be an object of domain-to-tags entries");
  }
  const mapping = new Map<string, string[]>();
  for (const [domain, tags] of Object.entries(value)) {
    const values = typeof tags === "string" ? [tags] : tags;
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      !values.every((tag) => typeof tag === "string" && tag.trim())
    ) {
      throw new InvalidArgumentError(`Mapping for ${domain} must contain tag names`);
    }
    mapping.set(normalizeDomain(domain), values.map((tag) => tag.trim()));
  }
  return mapping;
};

const formatPlan = (plan: TagPlan[]): string =>
  plan
    .map(
      (entry) =>
        `${entry.title ?? "Untitled"}\n  ${entry.url}\n  add: ${(entry.tagsToAdd ?? []).join(", ")}\n  remove: ${(entry.tagsToRemove ?? []).join(", ")}`,
    )
    .join("\n\n");

const positiveInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("Expected a positive integer");
  }
  return parsed;
};

const readingReport = (links: Link[]): string => {
  const domains = count(
    links.map((link) => domainOf(link.url)).filter((domain) => domain),
  );
  const tags = count(links.flatMap((link) => link.tags ?? []));
  const weekly = new Map<string, { read: number; saved: number }>();
  for (const link of links) {
    incrementWeek(weekly, link.addedAt, "saved");
    if (link.readAt) {
      incrementWeek(weekly, link.readAt, "read");
    }
  }
  const weeklyRows = [...weekly]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([week, values]) => `| ${week} | ${values.saved} | ${values.read} |`);
  const domainRows = topCounts(domains).map(
    ([domain, total]) => `| ${domain} | ${total} |`,
  );
  const tagRows = topCounts(tags).map(([tag, total]) => `| ${tag} | ${total} |`);

  return [
    "# GoodLinks Reading Report",
    "",
    `Generated ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "## Summary",
    "",
    "| Metric | Count |",
    "| --- | ---: |",
    `| Total links | ${links.length} |`,
    `| Read links | ${links.filter((link) => link.readAt !== null).length} |`,
    `| Unread links | ${links.filter((link) => link.readAt === null).length} |`,
    `| Starred links | ${links.filter((link) => link.starred).length} |`,
    "",
    "## Weekly activity",
    "",
    "| Week starting | Saved | Read |",
    "| --- | ---: | ---: |",
    ...weeklyRows,
    "",
    "## Top domains",
    "",
    "| Domain | Links |",
    "| --- | ---: |",
    ...domainRows,
    "",
    "## Top tags",
    "",
    "| Tag | Links |",
    "| --- | ---: |",
    ...tagRows,
  ].join("\n");
};

const count = (values: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
};

const topCounts = (counts: Map<string, number>): Array<[string, number]> =>
  [...counts].sort(
    ([leftName, left], [rightName, right]) =>
      right - left || leftName.localeCompare(rightName),
  );

const incrementWeek = (
  weekly: Map<string, { read: number; saved: number }>,
  timestamp: string,
  field: "read" | "saved",
) => {
  const week = weekStart(timestamp);
  const values = weekly.get(week) ?? { read: 0, saved: 0 };
  values[field] += 1;
  weekly.set(week, values);
};

const weekStart = (timestamp: string): string => {
  const date = new Date(timestamp);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
};

const exportFields: Array<keyof Link> = [
  "id",
  "url",
  "title",
  "summary",
  "author",
  "tags",
  "wordCount",
  "starred",
  "highlighted",
  "addedAt",
  "modifiedAt",
  "readAt",
];

const csvExport = (links: Link[]): string =>
  [
    exportFields.join(","),
    ...links.map((link) =>
      exportFields
        .map((field) => {
          const value = field === "tags" ? (link.tags ?? []).join("|") : link[field];
          return csvCell(value);
        })
        .join(","),
    ),
  ].join("\n");

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const markdownExport = (links: Link[]): string =>
  [
    "# GoodLinks Export",
    "",
    ...links.flatMap((link) => [
      `## [${link.title ?? link.url}](${link.url})`,
      "",
      `- Saved: ${link.addedAt}`,
      `- Read: ${link.readAt ?? "Unread"}`,
      `- Starred: ${link.starred ? "Yes" : "No"}`,
      `- Tags: ${(link.tags ?? []).join(", ") || "None"}`,
      "",
      ...(link.summary ? [link.summary, ""] : []),
    ]),
  ].join("\n");
