import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }

  if (lines.length < maxLines && line) lines.push(line);

  const consumed = lines.join(" ");
  if (lines.length === maxLines && words.join(" ").length > consumed.length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:!?\s]+$/, "") + "…";
  }

  return lines;
}

function titleFontSize(lineCount: number, longestLine: number) {
  if (lineCount >= 4 || longestLine > 27) return 47;
  if (lineCount === 3 || longestLine > 22) return 53;
  return 59;
}

function categoryLabel(value: string) {
  const labels: Record<string, string> = {
    "MECLİS BAŞKANI": "MECLİS BAŞKANI",
    "MECLİS": "MECLİS",
    "YASAMA": "YASAMA",
    "KOMİSYON": "KOMİSYON",
    "MİLLETVEKİLİ": "MİLLETVEKİLİ",
  };
  return labels[value.toUpperCase()] ?? value.toUpperCase();
}

async function imageAsDataUri(url: string | null) {
  if (!url) return "";
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ ok: false, error: "id gerekli." }, { status: 400 });

    const { data: item, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, title, generated_title, generated_text, category, published_at, image_url")
      .eq("id", id)
      .single();

    if (error || !item) return NextResponse.json({ ok: false, error: "Haber bulunamadı." }, { status: 404 });

    const titleLines = wrapText(item.generated_title || item.title, 27, 4);
    const longestTitleLine = Math.max(...titleLines.map((line) => line.length), 0);
    const titleSize = titleFontSize(titleLines.length, longestTitleLine);

    const text = (item.generated_text || "").replace(/^📌[^\n]*\n\n/, "").split("\n\n")[0];
    const textLines = wrapText(text, 54, 2);
    const date = item.published_at
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(item.published_at))
      : "";

    const imageData = await imageAsDataUri(item.image_url);
    const image = imageData
      ? `<image href="${imageData}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="1080" height="1080" fill="#171717"/>`;

    const category = categoryLabel(item.category || "TBMM");
    const categoryWidth = Math.min(390, Math.max(145, category.length * 15 + 64));

    const titleStartY = 665 - Math.max(0, titleLines.length - 1) * 12;
    const titleSvg = titleLines
      .map((line, index) => `<text x="72" y="${titleStartY + index * (titleSize + 10)}">${escapeXml(line)}</text>`)
      .join("");

    const summaryStartY = titleStartY + titleLines.length * (titleSize + 10) + 42;
    const dividerY = summaryStartY - 45;
    const textSvg = textLines
      .map((line, index) => `<text x="72" y="${summaryStartY + index * 32}">${escapeXml(line)}</text>`)
      .join("");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.05"/>
      <stop offset="0.42" stop-color="#000000" stop-opacity="0.12"/>
      <stop offset="0.68" stop-color="#000000" stop-opacity="0.66"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.97"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6d28d9"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.50"/>
    </filter>
  </defs>

  ${image}
  <rect width="1080" height="1080" fill="url(#hero)"/>

  <!-- Halk Locası brand -->
  <rect x="52" y="48" width="334" height="76" rx="38" fill="#09090b" fill-opacity="0.74"/>
  <rect x="52" y="48" width="7" height="76" rx="3.5" fill="#a855f7"/>
  <circle cx="96" cy="86" r="20" fill="#ffffff"/>
  <circle cx="96" cy="86" r="8" fill="#6d28d9"/>
  <text x="132" y="96" fill="#ffffff" font-family="Arial, sans-serif" font-size="30" font-weight="800">HALK LOCASI</text>

  <!-- Breaking/news marker -->
  <circle cx="994" cy="86" r="34" fill="#ffffff" fill-opacity="0.94"/>
  <text x="994" y="95" text-anchor="middle" fill="#18181b" font-family="Arial, sans-serif" font-size="24" font-weight="800">HL</text>

  <!-- Category -->
  <rect x="56" y="535" width="${categoryWidth}" height="44" rx="22" fill="#a855f7"/>
  <text x="78" y="564" fill="#ffffff" font-family="Arial, sans-serif" font-size="19" font-weight="800" letter-spacing="0.6">${escapeXml(category)}</text>

  <!-- Dynamic headline -->
  <g filter="url(#shadow)" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="${titleSize}">${titleSvg}</g>

  <!-- Accent -->
  <rect x="72" y="${dividerY}" width="96" height="6" rx="3" fill="#a855f7"/>

  <!-- Summary -->
  <g fill="#f4f4f5" font-family="Arial, sans-serif" font-size="25" font-weight="500">${textSvg}</g>

  <!-- Footer -->
  <rect x="56" y="1006" width="968" height="1" fill="#ffffff" fill-opacity="0.25"/>
  <text x="56" y="1048" fill="#ffffff" font-family="Arial, sans-serif" font-size="19" font-weight="700">HALK LOCASI</text>
  <text x="1024" y="1048" text-anchor="end" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="18">${escapeXml(date)}  •  TBMM</text>
</svg>`
