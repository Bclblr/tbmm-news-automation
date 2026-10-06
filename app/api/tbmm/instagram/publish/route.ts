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
    if (!id) {
      return NextResponse.json({ ok: false, error: "id gerekli." }, { status: 400 });
    }

    const token = env("META_INSTAGRAM_ACCESS_TOKEN");
    const instagramUserId = env("META_INSTAGRAM_USER_ID");

    const { data: item, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, generated_title, generated_text, generated_image_url, published_to_instagram, instagram_media_id")
      .eq("id", id)
      .single();

    if (error || !item) {
      return NextResponse.json({ ok: false, error: "Haber bulunamadı." }, { status: 404 });
    }

    if (!item.generated_image_url) {
      return NextResponse.json({ ok: false, error: "Önce haber için 1080×1080 görsel oluşturulmalı." }, { status: 400 });
    }

    if (item.published_to_instagram || item.instagram_media_id) {
      return NextResponse.json({
        ok: true,
        alreadyPublished: true,
        mediaId: item.instagram_media_id,
      });
    }

    const caption = [
      item.generated_title || "",
      "",
      item.generated_text || "",
      "",
      "#TBMM #TürkiyeBüyükMilletMeclisi #HalkLocası",
    ].join("\n").trim();

    const createUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${instagramUserId}/media`;
    const createParams = new URLSearchParams({
      image_url: item.generated_image_url,
      caption,
      access_token: token,
    });

    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createParams,
      cache: "no-store",
    });

    const createData = await createResponse.json();

    if (!createResponse.ok || !createData.id) {
      const message = createData?.error?.message || "Instagram medya kapsayıcısı oluşturulamadı.";
      await supabaseAdmin
        .from("tbmm_news")
        .update({ publish_error: message, updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    const publishUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${instagramUserId}/media_publish`;
    const publishParams = new URLSearchParams({
      creation_id: createData.id,
      access_token: token,
    });

    const publishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams,
      cache: "no-store",
    });

    const publishData = await publishResponse.json();

    if (!publishResponse.ok || !publishData.id) {
      const message = publishData?.error?.message || "Instagram gönderisi yayınlanamadı.";
      await supabaseAdmin
        .from("tbmm_news")
        .update({ publish_error: message, updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("tbmm_news")
      .update({
        published_to_instagram: true,
        instagram_media_id: publishData.id,
        instagram_published_at: now,
        publish_error: null,
        status: "published",
        updated_at: now,
      })
      .eq("id", id);

    if (updateError) throw new Error(`Yayın durumu kaydedilemedi: ${updateError.message}`);

    return NextResponse.json({
      ok: true,
      mediaId: publishData.id,
      publishedAt: now,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Instagram yayınlama hatası." },
      { status: 500 },
    );
  }
}
