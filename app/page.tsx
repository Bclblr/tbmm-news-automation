"use client";

import { useState } from "react";

type NewsItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  category: string;
};

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [error, setError] = useState("");

  async function checkNews() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/tbmm/check", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Haberler alınamadı.");
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

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
        <div className="card"><span>Son kontrol</span><strong>{items.length ? "Az önce" : "Henüz yapılmadı"}</strong></div>
        <div className="card"><span>Bulunan haber</span><strong>{items.length}</strong></div>
        <div className="card"><span>Yayına hazır</span><strong>0</strong></div>
        <div className="card"><span>Yayınlanan</span><strong>0</strong></div>
      </section>

      <section className="main-card">
        <div>
          <p className="eyebrow">TBMM VERİ KAYNAĞI</p>
          <h2>Resmî haberleri kontrol et.</h2>
          <p className="muted">TBMM'nin Meclis, Yasama, Komisyon, Milletvekilleri ve Meclis Başkanı haber listelerini kontrol eder.</p>
        </div>
        <button onClick={checkNews} disabled={loading}>{loading ? "Kontrol ediliyor..." : "Haberleri Kontrol Et"}</button>
      </section>

      {error && <div className="error">{error}</div>}

      {items.length > 0 && (
        <section className="roadmap">
          <div className="section-title">
            <div><p className="eyebrow">SONUÇLAR</p><h2>TBMM'den alınan içerikler</h2></div>
            <span className="count">{items.length} kayıt</span>
          </div>
          <div className="news-list">
            {items.map((item) => (
              <article className="news-item" key={item.id}>
                <div>
                  <span className="tag">{item.category}</span>
                  <h3>{item.title}</h3>
                  <small>{item.publishedAt}</small>
                </div>
                <a href={item.url} target="_blank" rel="noreferrer">TBMM'de aç →</a>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="roadmap">
        <h2>Proje durumu</h2>
        <div className="steps">
          <div className="step active"><b>01</b><span>Panel</span><small>Hazır</small></div>
          <div className="step active"><b>02</b><span>TBMM veri kaynağı</span><small>Bağlandı</small></div>
          <div className="step"><b>03</b><span>Supabase veritabanı</span><small>Sonraki aşama</small></div>
          <div className="step"><b>04</b><span>İçerik motoru</span><small>Bekliyor</small></div>
          <div className="step"><b>05</b><span>Instagram + Facebook</span><small>Bekliyor</small></div>
        </div>
      </section>
    </main>
  );
}