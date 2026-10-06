import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ortam değişkeni eksik.`);
  return value;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ ok: false, error: "id gerekli." }, { status: 400 });

    const token = env("META_FACEBOOK_PAGE_ACCESS_TOKEN");
    const pageId = env("META_FACEBOOK_PAGE_ID");

    const { data: item, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, generated_title, generated_text, generated_image_url, published_to_facebook")
      .eq("id", id)
      .single();

    if (error || !item) return NextResponse.json({ ok: false, error: "Haber bulunamadı." }, { status: 404 });
    if (!item.generated_image_url) return NextResponse.json({ ok: false, error: "Haber görseli hazır değil." }, { status: 400 });
    if (item.published_to_facebook) return NextResponse.json({ ok: true, alreadyPublished: true });

    const message = [
      item.generated_title || "",
      "",
      item.generated_text || "",
      "",
      "#TBMM #TürkiyeBüyükMilletMeclisi #HalkLocası",
    ].join("\n").trim();

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`;
    const params = new URLSearchParams({ url: item.generated_image_url, caption: message, access_token: token });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      cache: "no-store",
    });
    const data = await response.json();

    if (!response.ok || !data?.id) {
      const errorMessage = data?.error?.message || "Facebook gönderisi yayınlanamadı.";
      await supabaseAdmin.from("tbmm_news").update({ publish_error: errorMessage, updated_at: new Date().toISOString() }).eq("id", id);
      return NextResponse.json({ ok: false, error: errorMessage }, { status: 502 });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin.from("tbmm_news").update({
      published_to_facebook: true,
      publish_error: null,
      updated_at: now,
    }).eq("id", id);

    if (updateError) throw new Error(`Facebook yayın durumu kaydedilemedi: ${updateError.message}`);
    return NextResponse.json({ ok: true, postId: data.id, publishedAt: now });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Facebook yayınlama hatası." }, { status: 500 });
  }
}
