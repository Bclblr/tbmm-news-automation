import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const FONT = "DejaVu Sans, sans-serif";

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
  if (lineCount >= 4 || longestLine > 27) return 46;
  if (lineCount === 3 || longestLine > 22) return 52;
  return 58;
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
    const textLines = wrapText(text, 58, 2);
    const date = item.published_at
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(item.published_at))
      : "";

    const imageData = await imageAsDataUri(item.image_url);
    const image = imageData
      ? `<image href="${imageData}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="1080" height="1080" fill="#15111f"/>`;

    const category = categoryLabel(item.category || "TBMM");
    const categoryWidth = Math.min(390, Math.max(150, category.length * 15 + 70));

    const titleStartY = 665 - Math.max(0, titleLines.length - 1) * 10;
    const titleSvg = titleLines
      .map((line, index) => `<text x="72" y="${titleStartY + index * (titleSize + 8)}">${escapeXml(line)}</text>`)
      .join("");

    const summaryStartY = titleStartY + titleLines.length * (titleSize + 8) + 38;
    const dividerY = summaryStartY - 38;
    const textSvg = textLines
      .map((line, index) => `<text x="72" y="${summaryStartY + index * 31}">${escapeXml(line)}</text>`)
      .join("");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05020a" stop-opacity="0"/>
      <stop offset="0.40" stop-color="#08040f" stop-opacity="0.10"/>
      <stop offset="0.67" stop-color="#08040f" stop-opacity="0.74"/>
      <stop offset="1" stop-color="#05020a" stop-opacity="0.98"/>
    </linearGradient>
    <linearGradient id="purple" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#c084fc"/>
    </linearGradient>
    <filter id="softShadow">
      <feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#000000" flood-opacity="0.65"/>
    </filter>
  </defs>

  ${image}
  <rect width="1080" height="1080" fill="url(#bottomShade)"/>

  <!-- top brand -->
  <rect x="48" y="44" width="350" height="82" rx="41" fill="#09070f" fill-opacity="0.82"/>
  <rect x="48" y="44" width="8" height="82" rx="4" fill="#a855f7"/>
  <circle cx="100" cy="85" r="25" fill="#ffffff"/>
  <circle cx="100" cy="85" r="10" fill="#7c3aed"/>
  <text x="140" y="96" fill="#ffffff" font-family="${FONT}" font-size="29" font-weight="700" letter-spacing="0.5">HALK LOCASI</text>

  <!-- visual identity mark -->
  <circle cx="994" cy="85" r="38" fill="#09070f" fill-opacity="0.78" stroke="#c084fc" stroke-width="2"/>
  <text x="994" y="95" text-anchor="middle" fill="#ffffff" font-family="${FONT}" font-size="23" font-weight="700">HL</text>

  <!-- category -->
  <rect x="56" y="526" width="${categoryWidth}" height="46" rx="23" fill="url(#purple)"/>
  <text x="80" y="557" fill="#ffffff" font-family="${FONT}" font-size="18" font-weight="700" letter-spacing="0.5">${escapeXml(category)}</text>

  <!-- headline -->
  <g filter="url(#softShadow)" fill="#ffffff" font-family="${FONT}" font-weight="800" font-size="${titleSize}">
    ${titleSvg}
  </g>

  <!-- accent rule -->
  <rect x="72" y="${dividerY}" width="112" height="7" rx="3.5" fill="#c084fc"/>

  <!-- summary -->
  <g fill="#f5f3f7" font-family="${FONT}" font-size="24" font-weight="400">
    ${textSvg}
  </g>

  <!-- footer -->
  <rect x="56" y="1004" width="968" height="1" fill="#ffffff" fill-opacity="0.24"/>
  <text x="56" y="1048" fill="#ffffff" font-family="${FONT}" font-size="18" font-weight="700" letter-spacing="1">HALK LOCASI</text>
  <text x="1024" y="1048" text-anchor="end" fill="#d8d3df" font-family="${FONT}" font-size="17">${escapeXml(date)}  •  TBMM</text>
</svg>`;

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const path = `tbmm/${id}.png`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("social-images")
      .upload(path, png, { contentType: "image/png", cacheControl: "31536000", upsert: true });

    if (uploadError) throw new Error(`Görsel yüklenemedi: ${uploadError.message}`);

    const { data: publicData } = supabaseAdmin.storage.from("social-images").getPublicUrl(path);
    const imageUrl = publicData.publicUrl;

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
