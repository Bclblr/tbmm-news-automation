import { NextResponse } from "next/server";
import { fetchTbmmNews } from "../../../../lib/tbmm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const news = await fetchTbmmNews();

    return NextResponse.json({
      ok: true,
      count: news.length,
      items: news.slice(0, 50),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Bilinmeyen hata",
      },
      { status: 500 },
    );
  }
}