export default function Home() {
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
        <div className="card"><span>Son kontrol</span><strong>Henüz yapılmadı</strong></div>
        <div className="card"><span>Yeni haber</span><strong>0</strong></div>
        <div className="card"><span>Yayına hazır</span><strong>0</strong></div>
        <div className="card"><span>Yayınlanan</span><strong>0</strong></div>
      </section>

      <section className="main-card">
        <div>
          <p className="eyebrow">KONTROL MERKEZİ</p>
          <h2>Haberleri kontrol etmeye hazırız.</h2>
          <p className="muted">Bir sonraki aşamada TBMM resmi veri kaynağını bağlayıp yeni içerikleri otomatik olarak veritabanına alacağız.</p>
        </div>
        <button>Haberleri Kontrol Et</button>
      </section>

      <section className="roadmap">
        <h2>Proje durumu</h2>
        <div className="steps">
          <div className="step active"><b>01</b><span>Panel</span><small>Hazır</small></div>
          <div className="step"><b>02</b><span>TBMM veri kaynağı</span><small>Sonraki aşama</small></div>
          <div className="step"><b>03</b><span>Supabase veritabanı</span><small>Bekliyor</small></div>
          <div className="step"><b>04</b><span>İçerik motoru</span><small>Bekliyor</small></div>
          <div className="step"><b>05</b><span>Instagram + Facebook</span><small>Bekliyor</small></div>
        </div>
      </section>
    </main>
  );
}