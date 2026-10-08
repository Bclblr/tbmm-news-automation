import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

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

    const rawToken = env("META_INSTAGRAM_ACCESS_TOKEN");
    const token = rawToken.trim();
    const instagramUserId = env("META_INSTAGRAM_USER_ID").trim();

    // Token'ın Vercel'e bozulmadan ulaştığını ve verilen Instagram kullanıcı
    // kimliğiyle Meta tarafından kabul edildiğini medya oluşturmadan önce doğrula.
    // Token'ın kendisi hiçbir şekilde loglanmaz veya response'a yazılmaz.
    const tokenDiagnostics = {
      length: token.length,
      hadOuterWhitespace: rawToken !== token,
      hasWhitespace: /\\s/.test(token),
      hasQuote: token.includes('"') || token.includes("'"),
      graphVersion: GRAPH_VERSION,
      instagramUserId,
    };

    if (!token || tokenDiagnostics.hasWhitespace || tokenDiagnostics.hasQuote) {
      return NextResponse.json(
        {
          ok: false,
          error: "META_INSTAGRAM_ACCESS_TOKEN Vercel ortamında biçimsel olarak hatalı görünüyor.",
          diagnostics: tokenDiagnostics,
        },
        { status: 500 },
      );
    }

    const validationUrl = new URL(
      `https://graph.instagram.com/${GRAPH_VERSION}/${instagramUserId}`,
    );
    validationUrl.searchParams.set("fields", "id,username");
    validationUrl.searchParams.set("access_token", token);

    const validationResponse = await fetch(validationUrl, {
      method: "GET",
      cache: "no-store",
    });
    const validationData = await validationResponse.json().catch(() => ({}));

    if (!validationResponse.ok || !validationData?.id) {
      const metaError = validationData?.error?.message || "Meta erişim doğrulaması başarısız.";
      return NextResponse.json(
        {
          ok: false,
          error: `Meta token doğrulaması başarısız: ${metaError}`,
          diagnostics: tokenDiagnostics,
        },
        { status: 502 },
      );
    }

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

    const createUrl = `https://graph.instagram.com/${GRAPH_VERSION}/${instagramUserId}/media`;
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

    const createData = await createResponse.json().catch(() => ({}));

    if (!createResponse.ok || !createData.id) {
      const metaError = createData?.error?.message;
      const metaCode = createData?.error?.code;
      const metaType = createData?.error?.type;
      const message = [
        "Instagram medya kapsayıcısı oluşturulamadı.",
        metaError ? `Meta: ${metaError}` : "",
        metaCode ? `Kod: ${metaCode}` : "",
        metaType ? `Tip: ${metaType}` : "",
      ].filter(Boolean).join(" ");
      await supabaseAdmin
        .from("tbmm_news")
        .update({ publish_error: message, updated_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    // Container'ın Instagram tarafından işlenmesini bekle.
    let containerStatus = "";
    let containerError = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const statusParams = new URLSearchParams({ fields: "status_code,status", access_token: token });
      const statusResponse = await fetch(
        `https://graph.instagram.com/${GRAPH_VERSION}/${createData.id}?${statusParams.toString()}`,
        { method: "GET", cache: "no-store" },
      );
      const statusData = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) {
        containerError = statusData?.error?.message || "Instagram medya durumu alınamadı.";
        break;
      }
      containerStatus = statusData?.status_code || statusData?.status || "";
      if (containerStatus === "FINISHED") break;
      if (containerStatus === "ERROR" || containerStatus === "EXPIRED") {
        containerError = containerStatus;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (containerStatus !== "FINISHED") {
      const message = [
        "Instagram medya kapsayıcısı yayınlanmaya hazır hale gelmedi.",
        containerError ? `Meta: ${containerError}` : `Durum: ${containerStatus || "bilinmiyor"}`,
        `Container ID: ${createData.id}`,
      ].filter(Boolean).join(" ");
      await supabaseAdmin.from("tbmm_news").update({
        publish_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    const publishUrl = `https://graph.instagram.com/${GRAPH_VERSION}/${instagramUserId}/media_publish`;
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

    const publishData = await publishResponse.json().catch(() => ({}));

    if (!publishResponse.ok || !publishData.id) {
      const metaError = publishData?.error?.message;
      const metaCode = publishData?.error?.code;
      const metaType = publishData?.error?.type;
      const message = [
        "Instagram medya kapsayıcısı oluşturuldu ancak gönderi yayınlanamadı.",
        metaError ? `Meta: ${metaError}` : "",
        metaCode ? `Kod: ${metaCode}` : "",
        metaType ? `Tip: ${metaType}` : "",
        createData?.id ? `Container ID: ${createData.id}` : "",
      ].filter(Boolean).join(" ");
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
      containerId: createData.id,
      publishedAt: now,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Instagram yayınlama hatası." },
      { status: 500 },
    );
  }
}
