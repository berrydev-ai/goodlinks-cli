import type { GoodLinksClient } from "./client.js";

export type Link = {
  addedAt: string;
  author: string | null;
  highlighted: boolean;
  id: string;
  modifiedAt: string;
  readAt: string | null;
  starred: boolean;
  summary: string | null;
  tags: string[] | null;
  title: string | null;
  url: string;
  wordCount: number | null;
};

export type Page<Item> = {
  data: Item[];
  hasMore: boolean;
};

/** Fetches every link from a list or search endpoint using API pagination. */
export const fetchAllLinks = async (
  client: GoodLinksClient,
  path = "/lists/all",
  query: Readonly<Record<string, boolean | number | string | readonly string[] | undefined>> = {},
): Promise<Link[]> => {
  const links: Link[] = [];
  let offset = 0;

  while (true) {
    const page = await client.request<Page<Link>>("GET", path, {
      query: { ...query, limit: 1000, offset },
    });
    links.push(...page.data);
    if (!page.hasMore || page.data.length === 0) {
      return links;
    }
    offset += page.data.length;
  }
};

/** Returns a normalized hostname, treating www.example.com as example.com. */
export const domainOf = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
