import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\x27/g, "&apos;");
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
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[.,;:!?\s]+$/, "") + "…";
  }
  return lines;
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return new NextResponse("id gerekli", { status: 400 });

    const { data: item, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("title, generated_title, generated_text, category, published_at, image_url")
      .eq("id", id)
      .single();

    if (error || !item) return new NextResponse("Haber bulunamadı", { status: 404 });

    const titleLines = wrapText(item.generated_title || item.title, 30, 4);
    const text = (item.generated_text || "").replace(/^📌[^\n]*\n\n/, "").split("\n\n")[0];
    const textLines = wrapText(text, 55, 4);
    const date = item.published_at
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(item.published_at))
      : "";

    const image = item.image_url
      ? '<image href="' + escapeXml(item.image_url) + '" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>'
      : "";

    const titleSvg = titleLines
      .map((line, index) => '<text x="80" y="' + (625 + index * 70) + '" class="title">' + escapeXml(line) + "</text>")
      .join("");

    const textSvg = textLines
      .map((line, index) => '<text x="80" y="' + (930 + index * 34) + '" class="body">' + escapeXml(line) + "</text>")
      .join("");

    const svg =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">' +
      '<defs><linearGradient id="overlay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0.05"/><stop offset="0.55" stop-color="#000000" stop-opacity="0.42"/><stop offset="1" stop-color="#000000" stop-opacity="0.94"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.55"/></filter></defs>' +
      '<rect width="1080" height="1080" fill="#18181b"/>' +
      image +
      '<rect width="1080" height="1080" fill="url(#overlay)"/>' +
      '<rect x="70" y="70" width="940" height="54" rx="27" fill="#111113" fill-opacity="0.86"/>' +
      '<text x="100" y="105" fill="#ffffff" font-family="Arial, sans-serif" font-size="25" font-weight="700">TBMM HABER OTOMASYONU</text>' +
      '<text x="80" y="565" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="24" font-weight="700">' +
      escapeXml((item.category || "TBMM").toUpperCase()) +
      "</text>" +
      '<g filter="url(#shadow)" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="58">' +
      titleSvg +
      "</g>" +
      '<g fill="#f4f4f5" font-family="Arial, sans-serif" font-size="26">' +
      textSvg +
      "</g>" +
      '<text x="80" y="1040" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="21">' +
      escapeXml(date) +
      "</text>" +
      '<text x="1000" y="1040" text-anchor="end" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="21">TBMM</text></svg>';

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : "Şablon oluşturulamadı.",
      { status: 500 },
    );
  }
}
