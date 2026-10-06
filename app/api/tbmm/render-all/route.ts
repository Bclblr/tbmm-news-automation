import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { data: items, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id")
      .in("status", ["ready", "published"])
      .order("published_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    let rendered = 0;
    const errors: string[] = [];

    for (let i = 0; i < (items ?? []).length; i += 5) {
      const batch = (items ?? []).slice(i, i + 5);

      const results = await Promise.all(
        batch.map(async ({ id }) => {
          try {
            const response = await fetch(new URL("/api/tbmm/render", request.url), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id }),
              cache: "no-store",
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) {
              return { ok: false, error: data.error ?? "Görsel oluşturulamadı." };
            }

            return { ok: true };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Görsel oluşturulamadı." };
          }
        }),
      );

      for (const result of results) {
        if (result.ok) rendered += 1;
        else if (result.error) errors.push(result.error);
      }
    }

    return NextResponse.json({
      ok: true,
      total: items?.length ?? 0,
      rendered,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Görseller yenilenemedi." },
      { status: 500 },
    );
  }
}
