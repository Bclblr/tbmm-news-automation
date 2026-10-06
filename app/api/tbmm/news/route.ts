import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: news, error: newsError } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, title, summary, source_url, published_at, category, image_url, status, generated_title, generated_text, generated_image_url, created_at")
      .order("published_at", { ascending: false })
      .limit(50);

    if (newsError) throw new Error(`Haberler alınamadı: ${newsError.message}`);

    const { count: total } = await supabaseAdmin
      .from("tbmm_news")
      .select("*", { count: "exact", head: true });

    const { count: ready } = await supabaseAdmin
      .from("tbmm_news")
      .select("*", { count: "exact", head: true })
      .eq("status", "ready");

    const { count: published } = await supabaseAdmin
      .from("tbmm_news")
      .select("*", { count: "exact", head: true })
      .eq("status", "published");

    const { data: latest } = await supabaseAdmin
      .from("tbmm_news")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      items: news ?? [],
      stats: {
        total: total ?? 0,
        ready: ready ?? 0,
        published: published ?? 0,
        latestCheck: latest?.created_at ?? null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bilinmeyen hata" },
      { status: 500 },
    );
  }
}