import { InvalidArgumentError, Option, type Command } from "commander";

import { createGoodLinksClient } from "../client.js";
import { resolveToken } from "../config.js";
import { writeJson, writeText } from "../output.js";

type GlobalOptions = {
  baseUrl: string;
  token?: string;
};

export type ApiCommandGroups = {
  tags: Command;
};

type ListOptions = {
  includeRead?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
  tag: string[];
};

type SearchOptions = ListOptions & {
  addedAfter?: string;
  addedBefore?: string;
  highlighted?: boolean;
  read?: boolean;
  readAfter?: string;
  readBefore?: string;
  sort?: string;
  starred?: boolean;
  tagged?: boolean;
  wordCountMax?: number;
  wordCountMin?: number;
};

/** Registers direct GoodLinks API resource commands. */
export const registerApiCommands = (program: Command): ApiCommandGroups => {
  const links = program.command("links").description("Read and manage links");

  links
    .command("get <id>")
    .description("Get one link by ID")
    .action(async (id: string) => {
      const client = await clientFor(program);
      writeJson(await client.request("GET", `/links/${encodeURIComponent(id)}`));
    });

  links
    .command("get-url <url>")
    .description("Get one link by its URL")
    .action(async (url: string) => {
      const client = await clientFor(program);
      writeJson(await client.request("GET", "/links", { query: { url } }));
    });

  links
    .command("current")
    .description("Get the link currently selected in GoodLinks")
    .action(async () => {
      const client = await clientFor(program);
      writeJson(await client.request("GET", "/links/current"));
    });

  addListOptions(
    links
      .command("list <list>")
      .description("Get links from a main GoodLinks list"),
  ).action(async (list: string, options: ListOptions) => {
    const client = await clientFor(program);
    writeJson(
      await client.request("GET", `/lists/${encodeURIComponent(list)}`, {
        query: {
          search: options.search,
          tag: options.tag,
          includeRead: options.includeRead,
          limit: options.limit,
          offset: options.offset,
        },
      }),
    );
  });

  addSearchOptions(
    links.command("search").description("Search links with filters and sorting"),
  ).action(async (options: SearchOptions) => {
    const client = await clientFor(program);
    writeJson(
      await client.request("GET", "/links", {
        query: {
          search: options.search,
          tag: options.tag,
          starred: options.starred,
          read: options.read,
          tagged: options.tagged,
          highlighted: options.highlighted,
          wordCountMin: options.wordCountMin,
          wordCountMax: options.wordCountMax,
          addedAfter: options.addedAfter,
          addedBefore: options.addedBefore,
          readAfter: options.readAfter,
          readBefore: options.readBefore,
          sort: options.sort,
          limit: options.limit,
          offset: options.offset,
        },
      }),
    );
  });

  links
    .command("content <id>")
    .description("Get article content")
    .addOption(
      new Option("--format <format>", "Content format")
        .choices(["html", "plaintext", "markdown"])
        .default("html"),
    )
    .option(
      "--no-auto-download",
      "Return only content already cached by GoodLinks",
    )
    .action(
      async (
        id: string,
        options: { autoDownload: boolean; format: string },
      ) => {
        const client = await clientFor(program);
        writeText(
          await client.request<string>(
            "GET",
            `/links/${encodeURIComponent(id)}/content`,
            {
              query: {
                format: options.format,
                autoDownload: options.autoDownload,
              },
              response: "text",
            },
          ),
        );
      },
    );

  links
    .command("add <url>")
    .description("Add a link or update the link with the same URL")
    .option("--title <title>", "Link title")
    .option("--summary <summary>", "Link summary")
    .option("--tag <tag>", "Tag; repeat for multiple tags", collect, [])
    .option("--read", "Mark the link as read")
    .option("--starred", "Star the link")
    .option("--added-at <timestamp>", "Original saved timestamp")
    .action(
      async (
        url: string,
        options: {
          addedAt?: string;
          read?: boolean;
          starred?: boolean;
          summary?: string;
          tag: string[];
          title?: string;
        },
      ) => {
        const client = await clientFor(program);
        writeJson(
          await client.request("POST", "/links", {
            body: defined({
              url,
              title: options.title,
              summary: options.summary,
              tags: options.tag.length > 0 ? options.tag : undefined,
              read: options.read || undefined,
              starred: options.starred || undefined,
              addedAt: options.addedAt,
            }),
          }),
        );
      },
    );

  links
    .command("edit <id>")
    .description("Edit link metadata")
    .option("--title <title>", "New title")
    .option("--summary <summary>", "New summary")
    .option("--starred <boolean>", "Set starred status", boolean)
    .option("--read <boolean>", "Set read status", boolean)
    .option("--add-tag <tag>", "Tag to add; repeat for multiple tags", collect, [])
    .option(
      "--remove-tag <tag>",
      "Tag to remove; repeat for multiple tags",
      collect,
      [],
    )
    .option("--tag <tag>", "Replacement tag; repeat for multiple tags", collect, [])
    .option("--clear-tags", "Replace all tags with an empty list")
    .action(
      async (
        id: string,
        options: {
          addTag: string[];
          clearTags?: boolean;
          read?: boolean;
          removeTag: string[];
          starred?: boolean;
          summary?: string;
          tag: string[];
          title?: string;
        },
      ) => {
        const tags = options.clearTags
          ? []
          : options.tag.length > 0
            ? options.tag
            : undefined;
        const client = await clientFor(program);
        writeJson(
          await client.request("PATCH", `/links/${encodeURIComponent(id)}`, {
            body: defined({
              title: options.title,
              summary: options.summary,
              starred: options.starred,
              read: options.read,
              addedTags:
                tags === undefined && options.addTag.length > 0
                  ? options.addTag
                  : undefined,
              removedTags:
                tags === undefined && options.removeTag.length > 0
                  ? options.removeTag
                  : undefined,
              tags,
            }),
          }),
        );
      },
    );

  links
    .command("delete <ids...>")
    .description("Move one or more links to trash")
    .action(async (ids: string[]) => {
      const client = await clientFor(program);
      await client.request("DELETE", "/links", {
        query: { id: ids },
        response: "void",
      });
      writeJson({ deleted: ids });
    });

  program
    .command("lists")
    .description("List visible GoodLinks collections")
    .action(async () => {
      const client = await clientFor(program);
      writeJson(await client.request("GET", "/lists"));
    });

  const tags = program
    .command("tags")
    .description("List tags and tag usage");
  tags
    .command("list")
    .description("List raw GoodLinks tag names")
    .action(async () => {
      const client = await clientFor(program);
      writeJson(await client.request("GET", "/tags"));
    });

  const highlights = program
    .command("highlights")
    .description("Search and manage highlights");

  highlights
    .command("search")
    .description("Search highlights")
    .option("--query <text>", "Search highlight content and notes")
    .option("--link-id <id>", "Filter by link ID")
    .option("--content <text>", "Filter by highlighted content")
    .option("--note <text>", "Filter by note")
    .option("--created-after <timestamp>", "Only highlights created after timestamp")
    .option("--created-before <timestamp>", "Only highlights created before timestamp")
    .addOption(
      new Option("--sort <order>", "Result sort order").choices([
        "newest",
        "oldest",
        "linkID",
        "content",
        "note",
      ]),
    )
    .option("--limit <number>", "Maximum results, from 1 to 1000", integer)
    .option("--offset <number>", "Number of results to skip", integer)
    .action(
      async (options: {
        content?: string;
        createdAfter?: string;
        createdBefore?: string;
        limit?: number;
        linkId?: string;
        note?: string;
        offset?: number;
        query?: string;
        sort?: string;
      }) => {
        const client = await clientFor(program);
        writeJson(
          await client.request("GET", "/highlights", {
            query: {
              q: options.query,
              linkID: options.linkId,
              content: options.content,
              note: options.note,
              createdAfter: options.createdAfter,
              createdBefore: options.createdBefore,
              sort: options.sort,
              limit: options.limit,
              offset: options.offset,
            },
          }),
        );
      },
    );

  highlights
    .command("edit <id>")
    .description("Set or clear a highlight note")
    .addOption(
      new Option("--note <note>", "New highlight note").conflicts("clearNote"),
    )
    .option("--clear-note", "Clear the highlight note")
    .action(
      async (id: string, options: { clearNote?: boolean; note?: string }) => {
        if (options.note === undefined && !options.clearNote) {
          throw new InvalidArgumentError("Pass --note or --clear-note");
        }
        const client = await clientFor(program);
        writeJson(
          await client.request(
            "PATCH",
            `/highlights/${encodeURIComponent(id)}`,
            { body: { note: options.clearNote ? "" : options.note } },
          ),
        );
      },
    );

  highlights
    .command("export <link-id>")
    .description("Export one link's highlights with the GoodLinks template")
    .action(async (linkId: string) => {
      const client = await clientFor(program);
      writeText(
        await client.request<string>(
          "GET",
          `/links/${encodeURIComponent(linkId)}/highlights/export`,
          { response: "text" },
        ),
      );
    });

  return { tags };
};

const clientFor = async (program: Command) => {
  const options = program.opts<GlobalOptions>();
  return createGoodLinksClient(options.baseUrl, await resolveToken(options.token));
};

const addListOptions = (command: Command): Command =>
  command
    .option("--search <text>", "Filter by title, summary, content, URL, or author")
    .option("--tag <tag>", "Filter by tag; repeat for multiple tags", collect, [])
    .option("--include-read", "Include read links where supported")
    .option("--limit <number>", "Maximum results, from 1 to 1000", integer)
    .option("--offset <number>", "Number of results to skip", integer);

const addSearchOptions = (command: Command): Command =>
  addListOptions(command)
    .option("--starred <boolean>", "Filter by starred status", boolean)
    .option("--read <boolean>", "Filter by read status", boolean)
    .option("--tagged <boolean>", "Filter by tag presence", boolean)
    .option("--highlighted <boolean>", "Filter by highlight presence", boolean)
    .option("--word-count-min <number>", "Minimum word count", integer)
    .option("--word-count-max <number>", "Maximum word count", integer)
    .option("--added-after <timestamp>", "Only links added after this timestamp")
    .option("--added-before <timestamp>", "Only links added before this timestamp")
    .option("--read-after <timestamp>", "Only links read after this timestamp")
    .option("--read-before <timestamp>", "Only links read before this timestamp")
    .addOption(
      new Option("--sort <order>", "Result sort order").choices([
        "newestSaved",
        "oldestSaved",
        "newestRead",
        "oldestRead",
        "shortest",
        "longest",
        "titleA",
        "titleZ",
      ]),
    );

const collect = (value: string, values: string[]): string[] => [...values, value];

const integer = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError("Expected an integer");
  }
  return parsed;
};

const boolean = (value: string): boolean => {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new InvalidArgumentError("Expected true or false");
};

const defined = (
  values: Readonly<Record<string, unknown | undefined>>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
