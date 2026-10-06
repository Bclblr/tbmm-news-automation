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
  { category: "milletvekilleri" as const, path: "/meclis-haber/milletvekili" },
];

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    }
    return namedEntities[lower] ?? entity;
  });
}

function cleanText(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function getMeta(html: string, name: string) {
  const tags = html.match(/<meta[^>]*>/gi) ?? [];
  const wanted = name.toLowerCase();

  for (const tag of tags) {
    const nameMatch = tag.match(/(?:property|name)=[\"']([^\"']+)[\"']/i);
    const contentMatch = tag.match(/content=[\"']([^\"']*)[\"']/i);
    if (nameMatch?.[1]?.toLowerCase() === wanted && contentMatch) {
      return decodeHtmlEntities(contentMatch[1].trim());
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

function isBoilerplate(value: string) {
  const text = cleanText(value);
  return !text ||
    /Türkiye Büyük Millet Meclisi Resmi İnternet Sites/i.test(text) ||
    /^Resmi İnternet Sitesi$/i.test(text);
}

function extractJsonLdText(html: string) {
  const scripts = Array.from(
    html.matchAll(/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi),
  );

  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]));
      const candidates = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
          ? parsed["@graph"]
          : [parsed];

      for (const item of candidates) {
        if (!item || typeof item !== "object") continue;
        const articleBody =
          typeof item.articleBody === "string" ? cleanText(item.articleBody) : "";
        if (articleBody.length >= 60 && !isBoilerplate(articleBody)) {
          return articleBody;
        }

        const description =
          typeof item.description === "string" ? cleanText(item.description) : "";
        if (description.length >= 60 && !isBoilerplate(description)) {
          return description;
        }
      }
    } catch {
      // Ignore malformed JSON-LD and continue with HTML extraction.
    }
  }

  return "";
}

function extractMainText(html: string) {
  const jsonLdText = extractJsonLdText(html);
  if (jsonLdText) return jsonLdText.slice(0, 50000);

  const paragraphs = Array.from(
    html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi),
  )
    .map((match) => cleanText(match[1]))
    .filter((text) =>
      text.length >= 35 &&
      !isBoilerplate(text),
    );

  const unique = Array.from(new Set(paragraphs));
  if (unique.length) return unique.join("\n\n").slice(0, 50000);

  const contentCandidates = [
    ...Array.from(html.matchAll(/<(?:div|section)[^>]+(?:class|id)=[\"'][^\"']*(?:haber|news|detail|content|article|description|text)[^\"']*[\"'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi)),
    ...Array.from(html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)),
    ...Array.from(html.matchAll(/<main[^>]*>([\s\S]*?)<\/main>/gi)),
  ]
    .map((match) => cleanText(match[1]))
    .filter((text) => text.length >= 60 && !isBoilerplate(text));

  return (contentCandidates[0] ?? "").slice(0, 50000);
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
    headers: {
      "User-Agent": "TBMM-News-Automation/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
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
  const description = getMeta(html, "description") ?? getMeta(html, "og:description") ?? "";
  const extractedContent = extractMainText(html);
  const cleanedDescription = cleanText(description);

  // TBMM bazı haber sayfalarında meta description yerine site adını döndürüyor.
  // Böyle bir durumda bu değeri haber özeti olarak kabul etmiyoruz.
  const usableDescription =
    cleanedDescription.length >= 35 && !isBoilerplate(cleanedDescription)
      ? cleanedDescription
      : "";

  const content =
    extractedContent && !isBoilerplate(extractedContent)
      ? extractedContent
      : usableDescription;

  const firstParagraph =
    content
      .split(/\n\n+/)
      .map((part) => cleanText(part))
      .find((part) => part.length >= 35 && !isBoilerplate(part)) ?? "";

  const summary = firstParagraph.slice(0, 500);
  const publishedAt = getMeta(html, "article:published_time") ?? extractDate(html);
  const imageUrl = extractImage(html);
  const contentHash = simpleHash([title, publishedAt, content, item.url].join("|"));

  return {
    ...item,
    title: cleanText(title),
    summary,
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
      headers: {
        "User-Agent": "TBMM-News-Automation/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `TBMM kaynağı alınamadı: ${source.path} (${response.status})`,
      );
    }

    const html = await response.text();
    const linkRegex =
      /<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/a>/gi;

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
