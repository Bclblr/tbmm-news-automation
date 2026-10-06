import pathModule from "node:path";
import { NextResponse } from "next/server";
import { Resvg } from "@resvg/resvg-js";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const FONT = "Noto Sans";

function escapeXml(value: string) {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(value: string, maxChars: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function fitSummaryText(value: string, startY: number) {
  const bottomY = 980;
  const availableHeight = Math.max(120, bottomY - startY);
  const clean = value.trim();

  for (let fontSize = 30; fontSize >= 20; fontSize -= 1) {
    const lineHeight = Math.round(fontSize * 1.35);
    const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const maxChars = Math.max(28, Math.floor(68 * (27 / fontSize)));
    const lines = wrapText(clean, maxChars);
    if (lines.length <= maxLines) return { fontSize, lineHeight, lines };
  }

  const fontSize = 20;
  const lineHeight = Math.round(fontSize * 1.35);
  const maxChars = Math.max(28, Math.floor(68 * (27 / fontSize)));
  return { fontSize, lineHeight, lines: wrapText(clean, maxChars) };
}
function titleFontSize(lineCount: number, longestLine: number) {
  if (lineCount >= 4 || longestLine > 27) return 46;
  if (lineCount === 3 || longestLine > 22) return 52;
  return 58;
}

function categoryLabel(value: string) {
  return value.toLocaleUpperCase("tr-TR");
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
      .select("id, title, summary, generated_title, generated_text, category, published_at, image_url")
      .eq("id", id)
      .single();

    if (error || !item) return NextResponse.json({ ok: false, error: "Haber bulunamadı." }, { status: 404 });

    const rawHeadline = item.generated_title || item.title || "";
    const headline = rawHeadline
      .replace(/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/gi, "")
      .replace(/\s+/g, " ")
      .trim() || "Meclis gündeminden yeni gelişme";
    const titleLines = wrapText(headline, 27);
    const longestTitleLine = Math.max(...titleLines.map((line) => line.length), 0);
    const titleSize = titleFontSize(titleLines.length, longestTitleLine);

    const generatedBody = (item.generated_text || "")
      .replace(/^📌[^\n]*\n\n/, "")
      .split("\n\n")
      .filter((part: string) => !/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/i.test(part))
      .filter((part: string) => !/^🔎 Detaylar/i.test(part))
      .filter((part: string) => !/^#TBMM/i.test(part))
      .join("\n\n")
      .trim();

    const text = (generatedBody || item.summary || "")
      .replace(/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const date = item.published_at
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(item.published_at))
      : "";

    const imageData = await imageAsDataUri(item.image_url);
    const image = imageData
      ? `<image href="${imageData}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="1080" height="1080" fill="#15111f"/>`;

    const category = categoryLabel(item.category || "TBMM");
    const categoryWidth = Math.min(390, Math.max(150, category.length * 15 + 70));

    const titleStartY = 600 - Math.max(0, titleLines.length - 1) * 8;
    const titleSvg = titleLines
      .map((line, index) => `<text x="72" y="${titleStartY + index * (titleSize + 8)}">${escapeXml(line)}</text>`)
      .join("");

    const summaryStartY = titleStartY + titleLines.length * (titleSize + 8) + 130;
    const summary = fitSummaryText(text || "TBMM gündeminden güncel gelişme.", summaryStartY);
    const textLines = summary.lines;
    const summaryFontSize = summary.fontSize;
    const summaryLineHeight = summary.lineHeight;
    const summaryEndY = summaryStartY + Math.max(0, textLines.length - 1) * summaryLineHeight + summaryFontSize;
    const dividerY = titleStartY + titleLines.length * (titleSize + 8) + 34;
    const panelTop = Math.max(500, dividerY - 24);
    const panelBottom = Math.min(995, summaryEndY + 34);
    const panelHeight = Math.max(120, panelBottom - panelTop);
    const textSvg = textLines
      .map((line, index) => `<text x="72" y="${summaryStartY + index * summaryLineHeight}">${escapeXml(line)}</text>`)
      .join("");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.48" stop-color="#000000" stop-opacity="0.12"/>
      <stop offset="0.70" stop-color="#000000" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.98"/>
    </linearGradient>
    <filter id="softShadow">
      <feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  ${image}
  <rect width="1080" height="1080" fill="url(#bottomShade)"/>

  <g filter="url(#softShadow)" fill="#ffffff" font-family="${FONT}" font-weight="700" font-size="${titleSize}">
    ${titleSvg}
  </g>

  <rect x="72" y="${dividerY}" width="112" height="7" rx="3.5" fill="#ffffff"/>

  <g fill="#f5f5f5" font-family="${FONT}" font-size="${summaryFontSize}" font-weight="400">
    ${textSvg}
  </g>

  <rect x="56" y="1004" width="968" height="1" fill="#ffffff" fill-opacity="0.24"/>
  <text x="56" y="1048" fill="#ffffff" font-family="${FONT}" font-size="18" font-weight="700" letter-spacing="1">HALK LOCASI</text>
  <text x="1024" y="1048" text-anchor="end" fill="#d8d3df" font-family="${FONT}" font-size="17">${escapeXml(date)}  •  TBMM</text>
</svg>`;

    const fontDir = pathModule.join(process.cwd(), "node_modules", "notosans-fontface", "fonts");
    const regularFont = pathModule.join(fontDir, "NotoSans-Regular.ttf");
    const boldFont = pathModule.join(fontDir, "NotoSans-Bold.ttf");

    const renderer = new Resvg(svg, {
      fitTo: { mode: "original" },
      background: "rgba(0,0,0,0)",
      font: {
        loadSystemFonts: false,
        fontFiles: [regularFont, boldFont],
        defaultFontFamily: FONT,
        sansSerifFamily: FONT,
      },
    });
    const png = renderer.render().asPng();

    const path = `tbmm/${id}.png`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("social-images")
      .upload(path, png, { contentType: "image/png", cacheControl: "0", upsert: true });

    if (uploadError) throw new Error(`Görsel yüklenemedi: ${uploadError.message}`);

    const { data: publicData } = supabaseAdmin.storage.from("social-images").getPublicUrl(path);
    const imageUrl = `${publicData.publicUrl}?v=${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { error: updateError } = await supabaseAdmin
      .from("tbmm_news")
      .update({ generated_image_url: imageUrl, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) throw new Error(`Haber görsel URL'si kaydedilemedi: ${updateError.message}`);

    return NextResponse.json({ ok: true, imageUrl, width: 1080, height: 1080 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PNG oluşturulamadı." }, { status: 500 });
  }
}
