import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildHeadline(title: string, category: string) {
  const normalized = cleanText(title);
  if (!normalized) return "TBMM'den yeni gelişme";
  if (normalized.length <= 90) return normalized;
  return normalized.slice(0, 87).replace(/[,:;.!?\s]+$/, "") + "…";
}

function buildSocialText(title: string, summary: string, category: string) {
  const cleanTitle = cleanText(title);
  const cleanSummary = cleanText(summary);
  const prefix = category ? `📌 ${category}` : "📌 TBMM";
  const body = cleanSummary || cleanTitle;
  const clipped = body.length > 420 ? body.slice(0, 417).replace(/[,:;.!?\s]+$/, "") + "…" : body;

  return `${prefix}

${clipped}

🔎 Detaylar için TBMM'nin resmî haber kaynağını inceleyebilirsiniz.

#TBMM #TürkiyeBüyükMilletMeclisi`;
}

export async function POST() {
  try {
    const { data: news, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, title, summary, category, status")
      .eq("status", "new")
      .order("published_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(`Yeni haberler alınamadı: ${error.message}`);

    if (!news?.length) {
      return NextResponse.json({ ok: true, generated: 0, message: "İçerik üretilecek yeni haber yok." });
    }

    let generated = 0;

    for (const item of news) {
      const generatedTitle = buildHeadline(item.title, item.category);
      const generatedText = buildSocialText(item.title, item.summary, item.category);

      const { error: updateError } = await supabaseAdmin
        .from("tbmm_news")
        .update({
          generated_title: generatedTitle,
          generated_text: generatedText,
          status: "ready",
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id)
        .eq("status", "new");

      if (updateError) throw new Error(`İçerik güncellenemedi: ${updateError.message}`);
      generated += 1;
    }

    let rendered = 0;
    const generatedIds = news.map((item) => item.id);

    for (const id of generatedIds) {
      const renderResponse = await fetch(new URL("/api/tbmm/render", request.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        cache: "no-store",
      });

      if (!renderResponse.ok) {
        const renderData = await renderResponse.json().catch(() => ({}));
        throw new Error(renderData.error ?? "Görsel oluşturulamadı.");
      }

      rendered += 1;
    }

    return NextResponse.json({ ok: true, generated, rendered });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "İçerik üretilemedi." },
      { status: 500 },
    );
  }
}
