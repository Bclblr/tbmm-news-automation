"use client";

import { useEffect, useState } from "react";

type NewsItem = {
  id: string;
  title: string;
  summary: string;
  source_url: string;
  published_at: string | null;
  category: string;
  image_url?: string | null;
  status: string;
  generated_title?: string | null;
  generated_text?: string | null;
  generated_image_url?: string | null;
};

type Stats = {
  total: number;
  ready: number;
  published: number;
  latestCheck: string | null;
};

const emptyStats: Stats = { total: 0, ready: 0, published: 0, latestCheck: null };

function formatDate(value: string | null) {
  if (!value) return "Tarih yok";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [renderingAll, setRenderingAll] = useState(false);

  async function loadNews() {
    const response = await fetch("/api/tbmm/news", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Haberler alınamadı.");
    setItems(data.items ?? []);
    setStats(data.stats ?? emptyStats);
  }

  async function generateContent() {
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/tbmm/generate", { method: "POST", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "İçerik üretilemedi.");
      await loadNews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setGenerating(false);
    }
  }

  async function renderImage(id: string) {
    setRenderingId(id);
    setError("");
    try {
      const response = await fetch("/api/tbmm/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "PNG oluşturulamadı.");
      await loadNews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Görsel oluşturulamadı.");
    } finally {
      setRenderingId(null);
    }
  }

  async function renderAllImages() {
    setRenderingAll(true);
    setError("");
    try {
      const response = await fetch("/api/tbmm/render-all", {
        method: "POST",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Görseller yenilenemedi.");
      await loadNews();
      if (data.errors?.length) {
        setError(`${data.rendered}/${data.total} görsel yenilendi. Bazı görseller oluşturulamadı.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Görseller yenilenemedi.");
    } finally {
      setRenderingAll(false);
    }
  }

  async function checkNews() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/tbmm/check", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Haber kontrolü başarısız.");
      await loadNews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNews().catch((err) => {
      setError(err instanceof Error ? err.message : "Veriler yüklenemedi.");
    });
  }, []);

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <p className="eyebrow">KİŞİSEL OTOMASYON PANELİ</p>
          <h1>TBMM Haber Otomasyonu</h1>
          <p className="muted">Türkiye Büyük Millet Meclisi resmi içeriklerini takip et, hazırla ve yayınla.</p>
        </div>
        <span className="status"><i /> Sistem aktif</span>
      </header>

      <section className="stats">
        <div className="card"><span>Son kayıt</span><strong>{stats.latestCheck ? formatDate(stats.latestCheck) : "Henüz yok"}</strong></div>
        <div className="card"><span>Toplam haber</span><strong>{stats.total}</strong></div>
        <div className="card"><span>Yayına hazır</span><strong>{stats.ready}</strong></div>
        <div className="card"><span>Yayınlanan</span><strong>{stats.published}</strong></div>
      </section>

      <section className="main-card">
        <div>
          <p className="eyebrow">TBMM VERİ KAYNAĞI</p>
          <h2>Resmî haberleri kontrol et.</h2>
          <p className="muted">TBMM'nin Meclis, Yasama, Komisyon, Milletvekilleri ve Meclis Başkanı haber listelerini kontrol eder.</p>
        </div>
        <div className="actions">
          <button onClick={checkNews} disabled={loading || generating || renderingAll}>{loading ? "Kontrol ediliyor..." : "Haberleri Kontrol Et"}</button>
          <button className="secondary-button" onClick={generateContent} disabled={generating || loading || renderingAll}>
            {generating ? "İçerik hazırlanıyor..." : "İçerik Üret"}
          </button>
          <button className="secondary-button" onClick={renderAllImages} disabled={renderingAll || generating || loading}>
            {renderingAll ? "Görseller yenileniyor..." : "Tüm Görselleri Yenile"}
          </button>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="roadmap">
        <div className="section-title">
          <div><p className="eyebrow">SUPABASE</p><h2>Kayıtlı TBMM haberleri</h2></div>
          <span className="count">{items.length} gösteriliyor</span>
        </div>

        {items.length === 0 ? (
          <p className="muted">Henüz kayıtlı haber yok. “Haberleri Kontrol Et” butonuna basarak ilk taramayı başlat.</p>
        ) : (
          <div className="news-list">
            {items.map((item) => (
              <article className="news-item" key={item.id}>
                {item.image_url && <img className="news-image" src={item.image_url} alt="" />}
                <div className="news-content">
                  <span className="tag">{item.category}</span>
                  <h3>{item.title}</h3>
                  {item.summary && <p className="muted news-summary">{item.summary}</p>}
                  <span className={`status-badge status-${item.status}`}>{item.status === "ready" ? "Yayına hazır" : item.status === "published" ? "Yayınlandı" : "Yeni"}</span>
                  <small>{formatDate(item.published_at)} · {item.status}</small>
                </div>
                <div className="news-actions">
                  <button className="mini-button" onClick={() => renderImage(item.id)} disabled={renderingId === item.id || renderingAll || item.status !== "ready"}>
                    {renderingId === item.id ? "PNG hazırlanıyor..." : item.generated_image_url ? "PNG'yi yenile" : "1080×1080 PNG"}
                  </button>
                  {item.generated_image_url && <a href={item.generated_image_url} target="_blank" rel="noreferrer">Görseli aç →</a>}
                  <a href={item.source_url} target="_blank" rel="noreferrer">TBMM'de aç →</a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="roadmap">
        <h2>Proje durumu</h2>
        <div className="steps">
          <div className="step active"><b>01</b><span>Panel</span><small>Hazır</small></div>
          <div className="step active"><b>02</b><span>TBMM veri kaynağı</span><small>Bağlandı</small></div>
          <div className="step active"><b>03</b><span>Supabase veritabanı</span><small>Bağlandı</small></div>
          <div className="step"><b>04</b><span>İçerik motoru</span><small>Bekliyor</small></div>
          <div className="step"><b>05</b><span>Instagram + Facebook</span><small>Bekliyor</small></div>
        </div>
      </section>
    </main>
  );
}