import { NextResponse } from "next/server";
import { fetchTbmmNews } from "../../../../lib/tbmm";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const news = await fetchTbmmNews();

    if (news.length === 0) {
      return NextResponse.json({
        ok: true,
        fetched: 0,
        inserted: 0,
        skipped: 0,
        items: [],
        checkedAt: new Date().toISOString(),
      });
    }

    const rows = news.map((item) => ({
      source_id: item.id,
      title: item.title,
      summary: item.summary,
      content: item.content,
      source_url: item.url,
      category: item.category,
      published_at: item.publishedAt || null,
      image_url: item.imageUrl ?? null,
      content_hash: item.contentHash,
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabaseAdmin
      .from("tbmm_news")
      .upsert(rows, { onConflict: "source_url", ignoreDuplicates: false })
      .select("id, source_url");

    if (error) throw new Error(`Supabase kayıt hatası: ${error.message}`);

    return NextResponse.json({
      ok: true,
      fetched: news.length,
      inserted: data?.length ?? 0,
      skipped: 0,
      items: news,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bilinmeyen hata" },
      { status: 500 },
    );
  }
}
