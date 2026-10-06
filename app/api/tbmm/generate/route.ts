import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

function cleanText(value: string) {
  return value
    .replace(/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/gi, "")
    .replace(/🔎\\s*Detaylar[^\\n]*/gi, "")
    .replace(/#TBMM[^\\n]*/gi, "")
    .replace(/^📌[^\\n]*\\n?/i, "")
    .replace(/\\s+/g, " ")
    .trim();
}

function buildHeadline(title: string, summary: string, category: string) {
  const cleanTitleText = cleanText(title);
  const cleanSummary = cleanText(summary);

  if (!cleanTitleText && !cleanSummary) return "TBMM'den yeni gelişme";

  const source = cleanSummary || cleanTitleText;
  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^[•–—-]\s*/, "").trim())
    .filter(Boolean);

  let headline = sentences[0] || source;

  headline = headline
    .replace(/^Türkiye Büyük Millet Meclisi(?:'nde|'de|'nin|'den)?\s*/i, "")
    .replace(/^TBMM(?:'de|'nin|'den)?\s*/i, "")
    .replace(/^Meclis(?:'te|'de|'in|'ten)?\s*/i, "")
    .replace(/^\(?[^)]{0,60}\)?\s*(?:açıklama yaptı|açıklamasında|ifade etti|belirtti|söyledi)[:,]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const clauses = headline
    .split(/[,;:]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (headline.length > 78 && clauses.length > 1) {
    headline = clauses[0];
  }

  if (headline.length > 78) {
    const words = headline.split(/\s+/);
    headline = words.slice(0, 11).join(" ");
  }

  headline = headline.replace(/[,:;.!?]+$/, "").trim();

  if (headline.length < 20 && cleanTitleText && cleanTitleText !== headline) {
    const titleWords = cleanTitleText.replace(/\s+/g, " ").trim().split(" ");
    headline = titleWords.slice(0, 10).join(" ");
  }

  if (!headline) headline = category ? category + " gündeminde yeni gelişme" : "Meclis gündeminde yeni gelişme";

  if (headline.length > 78) {
    headline = headline.slice(0, 75).replace(/[,:;.!?\s]+$/, "") + "…";
  }

  return headline;
}

function buildSocialText(title: string, summary: string, category: string) {
  const cleanTitle = cleanText(title);
  const cleanSummary = cleanText(summary);

  // Görselin alt metni doğrudan haber özetinden oluşur; genel/tekrarlayan tanıtım metni kullanılmaz.
  const body = cleanSummary || "TBMM gündeminden güncel gelişme.";
  const clipped = body.length > 420
    ? body.slice(0, 417).replace(/[,:;.!?\s]+$/, "") + "…"
    : body;

  const prefix = category ? `📌 ${category}` : "📌 TBMM";

  return `${prefix}

${clipped}

#TBMM #TürkiyeBüyükMilletMeclisi`;
}

export async function POST(request: Request) {
  try {
    const { data: news, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, title, summary, category, status")
      .in("status", ["new", "ready"])
      .order("published_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(`Yeni haberler alınamadı: ${error.message}`);

    if (!news?.length) {
      return NextResponse.json({ ok: true, generated: 0, message: "İçerik üretilecek yeni haber yok." });
    }

    let generated = 0;

    for (const item of news) {
      const generatedTitle = buildHeadline(item.title, item.summary, item.category);
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
        .in("status", ["new", "ready"]);

      if (updateError) throw new Error(`İçerik güncellenemedi: ${updateError.message}`);
      generated += 1;
    }

    const generatedIds = news.map((item) => item.id);
    let rendered = 0;
    const renderErrors: string[] = [];

    // Vercel Hobby'de uzun süren isteklerin zaman aşımına uğramaması için
    // görselleri aynı anda sınırsız başlatmak yerine küçük gruplar halinde işleriz.
    for (let i = 0; i < generatedIds.length; i += 5) {
      const batch = generatedIds.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            const renderResponse = await fetch(new URL("/api/tbmm/render", request.url), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id }),
              cache: "no-store",
            });

            if (!renderResponse.ok) {
              const renderData = await renderResponse.json().catch(() => ({}));
              return { ok: false, error: renderData.error ?? "Görsel oluşturulamadı." };
            }

            return { ok: true };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : "Görsel oluşturulamadı." };
          }
        }),
      );

      for (const result of results) {
        if (result.ok) rendered += 1;
        else renderErrors.push(result.error);
      }
    }

    return NextResponse.json({
      ok: true,
      generated,
      rendered,
      renderErrors: renderErrors.slice(0, 5),
      message: renderErrors.length
        ? `${generated} içerik hazırlandı; ${rendered} görsel oluşturuldu.`
        : `${generated} içerik ve ${rendered} görsel hazırlandı.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "İçerik üretilemedi." },
      { status: 500 },
    );
  }
}
