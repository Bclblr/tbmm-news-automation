export type TbmmNewsItem = {
  id: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  publishedAt: string;
  category: "meclis" | "yasama" | "komisyon" | "milletvekilleri" | "meclis-baskani" | "diger";
  imageUrl?: string;
  contentHash: string;
};

const TBMM_BASE = "https://www.tbmm.gov.tr";

const categoryPaths = [
  { category: "meclis-baskani" as const, path: "/meclis-haber/meclis-baskani" },
  { category: "meclis" as const, path: "/meclis-haber/meclis" },
  { category: "yasama" as const, path: "/meclis-haber/yasama" },
  { category: "komisyon" as const, path: "/meclis-haber/komisyon" },
  { category: "milletvekilleri" as const, path: "/meclis-haber/milletvekilleri" },
];

function cleanText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getMeta(html: string, name: string) {
  const tags = html.match(/<meta[^>]*>/gi) ?? [];
  const wanted = name.toLowerCase();

  for (const tag of tags) {
    const nameMatch = tag.match(/(?:property|name)=["']([^"']+)["']/i);
    const contentMatch = tag.match(/content=["']([^"']*)["']/i);
    if (nameMatch?.[1]?.toLowerCase() === wanted && contentMatch) {
      return contentMatch[1].trim();
    }
  }

  return undefined;
}

function extractDate(html: string) {
  const match =
    html.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/) ??
    html.match(/\d{2}\.\d{2}\.\d{4}/);

  return match?.[0] ?? new Date().toISOString();
}

function extractImage(html: string) {
  return getMeta(html, "og:image") ?? getMeta(html, "twitter:image");
}

function extractMainText(html: string) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return cleanText(article ?? main ?? "").slice(0, 50000);
}

function simpleHash(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function fetchDetail(
  item: Omit<TbmmNewsItem, "content" | "summary" | "imageUrl" | "contentHash">,
) {
  const response = await fetch(item.url, {
    headers: { "User-Agent": "TBMM-News-Automation/1.0" },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ...item,
      summary: "",
      content: "",
      contentHash: simpleHash(item.url),
    } satisfies TbmmNewsItem;
  }

  const html = await response.text();
  const title = getMeta(html, "og:title") ?? item.title;
  const description =
    getMeta(html, "description") ?? getMeta(html, "og:description") ?? "";
  const content = extractMainText(html) || description;
  const publishedAt =
    getMeta(html, "article:published_time") ?? extractDate(html);
  const imageUrl = extractImage(html);
  const contentHash = simpleHash(
    [title, publishedAt, content, item.url].join("|"),
  );

  return {
    ...item,
    title: cleanText(title),
    summary: cleanText(description).slice(0, 500),
    content,
    publishedAt,
    imageUrl,
    contentHash,
  } satisfies TbmmNewsItem;
}

export async function fetchTbmmNews(): Promise<TbmmNewsItem[]> {
  const discovered = new Map<
    string,
    Omit<TbmmNewsItem, "content" | "summary" | "imageUrl" | "contentHash">
  >();

  for (const source of categoryPaths) {
    const response = await fetch(TBMM_BASE + source.path, {
      headers: { "User-Agent": "TBMM-News-Automation/1.0" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `TBMM kaynağı alınamadı: ${source.path} (${response.status})`,
      );
    }

    const html = await response.text();
    const linkRegex =
      /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const title = cleanText(match[2]);

      if (!title || title.length < 15 || !href) continue;
      if (!/\/Haber\/Detay\?Id=/i.test(href)) continue;

      const url = new URL(href, TBMM_BASE).toString();

      if (!discovered.has(url)) {
        discovered.set(url, {
          id: url.split("Id=")[1] ?? simpleHash(url),
          title,
          url,
          publishedAt: "",
          category: source.category,
        });
      }
    }
  }

  const items = Array.from(discovered.values()).slice(0, 50);
  const enriched: TbmmNewsItem[] = [];

  for (let i = 0; i < items.length; i += 5) {
    enriched.push(
      ...(await Promise.all(items.slice(i, i + 5).map(fetchDetail))),
    );
  }

  return enriched;
}
