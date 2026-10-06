export type TbmmNewsItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  category: "meclis" | "yasama" | "komisyon" | "milletvekilleri" | "meclis-baskani" | "diger";
  imageUrl?: string;
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
  return value.replace(/\\s+/g, " ").trim();
}

function extractDate(value: string) {
  const match = value.match(/\\d{4}-\\d{2}-\\d{2}\\s*-?\\s*\\d{2}:\\d{2}/);
  return match?.[0]?.replace(/\\s*-\\s*/, " ") ?? new Date().toISOString();
}

export async function fetchTbmmNews(): Promise<TbmmNewsItem[]> {
  const results: TbmmNewsItem[] = [];

  for (const source of categoryPaths) {
    const response = await fetch(TBMM_BASE + source.path, {
      headers: { "User-Agent": "TBMM-News-Automation/1.0" },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`TBMM kaynağı alınamadı: ${source.path} (${response.status})`);
    }

    const html = await response.text();

    // TBMM listeleri SSR HTML olarak geliyor. İlk sürümde haber bağlantılarını
    // doğrudan HTML'den çıkarıyoruz; detay sayfası parser'ı sonraki adımda eklenecek.
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1];
      const rawText = match[2].replace(/<[^>]*>/g, " ");
      const title = cleanText(rawText);

      if (!title || title.length < 15 || !href) continue;
      if (!/(haber|meclis-haber)/i.test(href)) continue;

      const url = new URL(href, TBMM_BASE).toString();
      const id = url.replace(/[^a-zA-Z0-9]/g, "").slice(-80);

      if (!results.some((item) => item.url === url)) {
        results.push({
          id,
          title,
          summary: "",
          url,
          publishedAt: extractDate(html),
          category: source.category,
        });
      }
    }
  }

  return results;
}