import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  const header = request.headers.get("x-cron-secret");
  return auth === `Bearer ${secret}` || header === secret;
}

async function callInternal(request: Request, path: string, method: "GET" | "POST", body?: unknown) {
  const response = await fetch(new URL(path, request.url), {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: request.headers.get("authorization") || "",
      "x-cron-secret": request.headers.get("x-cron-secret") || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function cleanupOldPublished() {
  const { data: keep, error: keepError } = await supabaseAdmin
    .from("tbmm_news")
    .select("id")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(10);

  if (keepError) throw new Error(`Son 10 kayıt alınamadı: ${keepError.message}`);
  const keepIds = (keep || []).map((row) => row.id);
  if (!keepIds.length) return { deletedRows: 0, deletedFiles: 0 };

  const { data: oldRows, error: oldError } = await supabaseAdmin
    .from("tbmm_news")
    .select("id")
    .eq("status", "published")
    .not("id", "in", `(${keepIds.join(",")})`);

  if (oldError) throw new Error(`Eski kayıtlar alınamadı: ${oldError.message}`);
  if (!oldRows?.length) return { deletedRows: 0, deletedFiles: 0 };

  const oldIds = oldRows.map((row) => row.id);
  const { data: files } = await supabaseAdmin.storage.from("social-images").list("tbmm", { limit: 1000 });
  const oldSet = new Set(oldIds);
  const paths = (files || [])
    .filter((file) => oldSet.has(file.name.replace(/\.png$/i, "")))
    .map((file) => `tbmm/${file.name}`);

  if (paths.length) await supabaseAdmin.storage.from("social-images").remove(paths);

  const { error: deleteError } = await supabaseAdmin.from("tbmm_news").delete().in("id", oldIds);
  if (deleteError) throw new Error(`Eski kayıtlar silinemedi: ${deleteError.message}`);

  return { deletedRows: oldIds.length, deletedFiles: paths.length };
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Yetkisiz otomasyon isteği." }, { status: 401 });
  return runAutomation(request);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Yetkisiz otomasyon isteği." }, { status: 401 });
  return runAutomation(request);
}

async function runAutomation(request: Request) {
  try {
    const check = await callInternal(request, "/api/tbmm/check", "GET");
    if (!check.response.ok || !check.data?.ok) throw new Error(check.data?.error || "TBMM haberleri kontrol edilemedi.");

    const generate = await callInternal(request, "/api/tbmm/generate?limit=1", "POST");
    if (!generate.response.ok || !generate.data?.ok) throw new Error(generate.data?.error || "İçerik üretilemedi.");

    const { data: item, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, generated_image_url, published_to_instagram, published_to_facebook")
      .eq("status", "ready")
      .order("published_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Yayınlanacak haber alınamadı: ${error.message}`);
    if (!item) {
      return NextResponse.json({
        ok: true,
        checked: check.data.fetched ?? 0,
        generated: generate.data.generated ?? 0,
        published: false,
        message: "Yeni yayınlanabilir haber yok.",
      });
    }

    let instagram = item.published_to_instagram;

    if (!instagram) {
      const result = await callInternal(request, "/api/tbmm/instagram/publish", "POST", { id: item.id });
      if (!result.response.ok || !result.data?.ok) throw new Error(result.data?.error || "Instagram paylaşımı başarısız.");
      instagram = true;
    }

    const now = new Date().toISOString();
    const { error: publishStateError } = await supabaseAdmin
      .from("tbmm_news")
      .update({ status: "published", updated_at: now, publish_error: null })
      .eq("id", item.id);

    if (publishStateError) throw new Error(`Yayın durumu kaydedilemedi: ${publishStateError.message}`);

    const cleanup = await cleanupOldPublished();

    return NextResponse.json({
      ok: true,
      checked: check.data.fetched ?? 0,
      generated: generate.data.generated ?? 0,
      published: true,
      instagram,
      cleanup,
      message: "Haber Instagram üzerinde paylaşıldı; Facebook çapraz paylaşımı Meta tarafından yönetilebilir.",
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Otomasyon başarısız." }, { status: 500 });
  }
}
