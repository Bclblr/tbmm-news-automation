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

type AiResult = { headline: string; summary: string };

async function generateWithGemini(title: string, summary: string, content: string, category: string): Promise<AiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallback(title, summary);
  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";
  const prompt = `Türkçe haber editörüsün. Aşağıdaki TBMM haberini sosyal medya için yeniden yaz.

KURALLAR:
- Orijinal başlığı kopyalama; haberi anlayıp yeni, kısa bir başlık yaz.
- Başlık 45-80 karakter olsun.
- 2-3 cümlelik 180-420 karakterlik özet yaz.
- Sadece kaynakta bulunan bilgileri kullan, bilgi uydurma.
- İsim, parti, kurum, tarih ve sayıları koru.
- "Türkiye Büyük Millet Meclisi Resmi İnternet Sitesi", "Resmi İnternet Sitesi", "Detaylar" ifadelerini kullanma.
- Gazeteci dili kullan.
- Yalnızca JSON döndür: {"headline":"...","summary":"..."}

KATEGORİ: ${category}
ORİJİNAL BAŞLIK: ${title}
MEVCUT ÖZET: ${summary}
HABER İÇERİĞİ:
${content.slice(0, 14000)}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, responseMimeType: "application/json" } }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Gemini API ${response.status}`);
  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini boş yanıt döndürdü.");
  const parsed = JSON.parse(raw) as Partial<AiResult>;
  const headline = String(parsed.headline || "").replace(/\s+/g, " ").trim();
  const aiSummary = String(parsed.summary || "").replace(/\s+/g, " ").trim();
  if (!headline || !aiSummary) throw new Error("Gemini geçerli içerik üretmedi.");
  return { headline, summary: aiSummary };
}

function fallback(title: string, summary: string): AiResult {
  return {
    headline: title.replace(/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/gi, "").trim() || "TBMM gündeminden yeni gelişme",
    summary: summary.replace(/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/gi, "").trim() || "TBMM gündeminden güncel gelişme.",
  };
}

export async function POST(request: Request) {
  try {
    const { data: news, error } = await supabaseAdmin
      .from("tbmm_news")
      .select("id, title, summary, content, category, status")
      .in("status", ["new", "ready"])
      .order("published_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(`Yeni haberler alınamadı: ${error.message}`);

    if (!news?.length) {
      return NextResponse.json({ ok: true, generated: 0, message: "İçerik üretilecek yeni haber yok." });
    }

    let generated = 0;

    for (const item of news) {
      let result: AiResult;
      try {
        result = await generateWithGemini(item.title, item.summary, item.content || "", item.category);
      } catch {
        result = fallback(item.title, item.summary);
      }
      const generatedTitle = result.headline;
      const generatedText = `📌 ${item.category || "TBMM"}

${result.summary}

#TBMM #TürkiyeBüyükMilletMeclisi`;

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
