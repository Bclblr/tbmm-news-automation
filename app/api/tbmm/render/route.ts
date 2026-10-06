import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = candidate;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:!?\s]+$/, "") + "…";
  }
  return lines;
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

    const titleLines = wrapText(item.generated_title || item.title, 30, 4);
    const text = (item.generated_text || "").replace(/^📌[^\n]*\n\n/, "").split("\n\n")[0];
    const textLines = wrapText(text, 55, 4);
    const date = item.published_at ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(item.published_at)) : "";
    const imageData = await imageAsDataUri(item.image_url);

    const image = imageData
      ? `<image href="${imageData}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
      : "";

    const titleSvg = titleLines.map((line, index) => `<text x="80" y="${625 + index * 70}">${escapeXml(line)}</text>`).join("");
    const textSvg = textLines.map((line, index) => `<text x="80" y="${930 + index * 34}">${escapeXml(line)}</text>`).join("");

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.05"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.94"/>
    </linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.55"/></filter>
  </defs>
  <rect width="1080" height="1080" fill="#18181b"/>
  ${image}
  <rect width="1080" height="1080" fill="url(#overlay)"/>
  <rect x="70" y="70" width="940" height="54" rx="27" fill="#111113" fill-opacity="0.86"/>
  <text x="100" y="105" fill="#ffffff" font-family="Arial, sans-serif" font-size="25" font-weight="700">TBMM HABER OTOMASYONU</text>
  <text x="80" y="565" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="24" font-weight="700">${escapeXml((item.category || "TBMM").toUpperCase())}</text>
  <g filter="url(#shadow)" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="58">${titleSvg}</g>
  <g fill="#f4f4f5" font-family="Arial, sans-serif" font-size="26">${textSvg}</g>
  <text x="80" y="1040" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="21">${escapeXml(date)}</text>
  <text x="1000" y="1040" text-anchor="end" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="21">TBMM</text>
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
