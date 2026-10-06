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

    const titleLines = wrapText(item.generated_title || item.title, 28, 4);
    const text = (item.generated_text || "").replace(/^📌[^\n]*\n\n/, "").split("\n\n")[0];
    const textLines = wrapText(text, 52, 3);
    const date = item.published_at ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(item.published_at)) : "";
    const imageData = await imageAsDataUri(item.image_url);

    const image = imageData
      ? `<image href="${imageData}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>`
      : `<rect width="1080" height="1080" fill="#171717"/>`;

    const titleSvg = titleLines
      .map((line, index) => `<text x="72" y="${690 + index * 64}">${escapeXml(line)}</text>`)
      .join("");
    const textSvg = textLines
      .map((line, index) => `<text x="72" y="${925 + index * 31}">${escapeXml(line)}</text>`)
      .join("");

    const category = (item.category || "TBMM").toUpperCase();

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.10"/>
      <stop offset="0.38" stop-color="#000000" stop-opacity="0.12"/>
      <stop offset="0.72" stop-color="#000000" stop-opacity="0.70"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6d28d9"/>
      <stop offset="1" stop-color="#9333ea"/>
    </linearGradient>
    <filter id="shadow">
      <feDropShadow dx="0" dy="5" stdDeviation="9" flood-color="#000000" flood-opacity="0.45"/>
    </filter>
  </defs>

  ${image}
  <rect width="1080" height="1080" fill="url(#hero)"/>

  <rect x="56" y="52" width="310" height="72" rx="36" fill="url(#brand)"/>
  <circle cx="94" cy="88" r="19" fill="#ffffff" fill-opacity="0.96"/>
  <circle cx="94" cy="88" r="7" fill="#6d28d9"/>
  <text x="126" y="97" fill="#ffffff" font-family="Arial, sans-serif" font-size="29" font-weight="800">HALK LOCASI</text>

  <rect x="56" y="560" width="${Math.min(350, Math.max(130, category.length * 16 + 58))}" height="46" rx="23" fill="#ffffff" fill-opacity="0.92"/>
  <text x="80" y="591" fill="#18181b" font-family="Arial, sans-serif" font-size="20" font-weight="800">${escapeXml(category)}</text>

  <g filter="url(#shadow)" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="55">${titleSvg}</g>

  <rect x="72" y="855" width="92" height="6" rx="3" fill="#a855f7"/>

  <g fill="#f4f4f5" font-family="Arial, sans-serif" font-size="25" font-weight="500">${textSvg}</g>

  <rect x="56" y="1010" width="968" height="1" fill="#ffffff" fill-opacity="0.28"/>
  <text x="56" y="1050" fill="#e4e4e7" font-family="Arial, sans-serif" font-size="19" font-weight="600">HALK LOCASI</text>
  <text x="1024" y="1050" text-anchor="end" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="18">${escapeXml(date)} · TBMM</text>
</svg>`

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
