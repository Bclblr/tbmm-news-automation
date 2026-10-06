import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

type AiResult = { headline: string; summary: string };

function cleanText(value: string) {
  return value
    .replace(/Türkiye Büyük Millet Meclisi Resmi İnternet Sites/gi, "")
    .replace(/Resmi İnternet Sitesi/gi, "")
    .replace(/🔎\s*Detaylar[^\n]*/gi, "")
    .replace(/#TBMM[^\n]*/gi, "")
    .replace(/^📌[^\n]*\n?/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoilerplate(value: string) {
  return /Türkiye Büyük Millet Meclisi Resmi İnternet Sites|Resmi İnternet Sitesi|Detaylar/i.test(value);
}

function wordOverlapRatio(a: string, b: string) {
  const normalize = (value: string) =>
    cleanText(value)
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-zçğıöşü0-9\s]/gi, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4);

  const sourceWords = new Set(normalize(a));
  const candidateWords = normalize(b);
  if (!candidateWords.length || !sourceWords.size) return 0;

  const overlap = candidateWords.filter((word) => sourceWords.has(word)).length;
  return overlap / candidateWords.length;
}

function validateAiResult(result: AiResult, originalTitle: string, sourceText: string): AiResult {
  const headline = cleanText(result.headline);
  const summary = cleanText(result.summary);

  if (!headline || !summary) throw new Error("Gemini geçerli içerik üretmedi.");
  if (isBoilerplate(headline) || isBoilerplate(summary)) throw new Error("Gemini resmi site kalıntısı üretti.");
  if (headline === cleanText(originalTitle)) throw new Error("Gemini orijinal başlığı kopyaladı.");
  if (headline.length < 25 || headline.length > 90) throw new Error("Gemini başlık uzunluğu uygun değil.");
  if (summary.length < 160 || summary.length > 500) throw new Error("Gemini metin uzunluğu uygun değil.");
  if (wordOverlapRatio(sourceText, summary) > 0.82) {
    throw new Error("Gemini kaynak metni fazla doğrudan kopyaladı.");
  }

  return { headline, summary };
}

async function generateWithGemini(
  title: string,
  summary: string,
  content: string,
  category: string,
): Promise<AiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  const sourceText = [title, summary, content].filter(Boolean).join("\n\n");

  if (!apiKey) return fallback(title, summary, content);

  const model = process.env.GEMINI_MODEL || "gemini-3.7-flash";

  const prompt = `Bu TBMM haberini sosyal medyada kullanılacak özgün bir Türkçe haber içeriğine dönüştür.

EDİTORYAL HEDEF:
Sen bir haber editörüsün. Kaynağı kopyalayan bir özetleyici gibi değil, aynı olayı daha akıcı ve anlaşılır biçimde yeniden yazan bir editör gibi davran. Başlık ve metin AYNI MERKEZİ GELİŞMEYİ anlatmalı; birbirini doğrulamalı ve çelişmemeli.

KURALLAR:
1. Kaynaktaki ana olayı belirle ve başlıkta en önemli gelişmeyi öne çıkar.
2. Orijinal başlığı kopyalama veya yalnızca birkaç kelimesini değiştirme. Yeni ve doğal bir başlık yaz.
3. Başlık 35-75 karakter aralığında, tek cümlelik ve haber diliyle yaz.
4. Metin 2-3 cümle ve 220-420 karakter aralığında olsun.
5. İlk cümlede ana gelişmeyi söyle; ikinci cümlede gerekiyorsa kişi, parti, kurum, tarih, sayı veya önemli ayrıntıyı ver.
6. Kaynakta olmayan hiçbir bilgi, yorum, neden-sonuç ilişkisi, niyet veya sonuç ekleme.
7. İsimleri, siyasi parti adlarını, kurumları, tarihleri ve sayıları değiştirme veya uydurma.
8. Kaynağın cümle yapısını ve ifadelerini birebir kopyalama; bilgileri koruyarak doğal biçimde yeniden kur.
9. "Türkiye Büyük Millet Meclisi Resmi İnternet Sitesi", "Resmi İnternet Sitesi", "Detaylar", "Kaynak", "haberde", "açıklamada" gibi mekanik veya siteye ait ifadeleri kullanma.
10. Emojiler, hashtagler, başlık etiketleri ve kaynak notları üretme.
11. Siyasi içerikte tarafsız, doğrulanabilir ve ölçülü haber dili kullan. Övgü, eleştiri, propaganda veya kişisel yorum ekleme.
12. Kaynak metin yetersizse bilgi uydurma; yalnızca doğrulanabilen kısmı yaz.

KATEGORİ:
${category}

ORİJİNAL BAŞLIK:
${title}

MEVCUT ÖZET:
${summary}

KAYNAK İÇERİK:
${content.slice(0, 14000)}

SADECE şu JSON nesnesini döndür:
{"headline":"özgün başlık","summary":"2-3 cümlelik özgün haber metni"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "Sen tarafsız bir Türkçe haber editörüsün. Kaynaktaki gerçekleri korur, metni doğal biçimde yeniden yazar ve bilgi uydurmazsın. Başlık ile haber metninin aynı ana gelişmeye odaklanmasını sağlarsın."
          }]
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              headline: { type: "STRING" },
              summary: { type: "STRING" }
            },
            required: ["headline", "summary"]
          }
        }
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Gemini API ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = await response.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini boş yanıt döndürdü.");

  let parsed: Partial<AiResult>;
  try {
    parsed = JSON.parse(raw) as Partial<AiResult>;
  } catch {
    throw new Error("Gemini JSON döndüremedi.");
  }

  return validateAiResult(
    {
      headline: String(parsed.headline || ""),
      summary: String(parsed.summary || ""),
    },
    title,
    sourceText,
  );
}

function fallback(title: string, summary: string, content: string): AiResult {
  const cleanTitle = cleanText(title);
  const sourceParagraph =
    content
      .split(/\n\n+/)
      .map((part) => cleanText(part))
      .find((part) => part.length >= 60) || cleanText(summary);

  return {
    headline:
      cleanTitle && cleanTitle.length <= 90
        ? cleanTitle
        : "TBMM gündeminden yeni gelişme",
    summary:
      sourceParagraph
        ? sourceParagraph.slice(0, 420)
        : "TBMM gündeminden güncel bir gelişme paylaşıldı.",
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
        result = fallback(item.title, item.summary, item.content || "");
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
