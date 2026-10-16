export const dynamic = "force-dynamic";

import { verifySession } from "@/lib/session";
import { loadEmotes } from "@/lib/emotes";

// Смайлики канала: Twitch (личный набор автора + канальные + глобальные),
// 7TV, BetterTTV, FrankerFaceZ. Вся логика — в lib/emotes.ts.
// ?refresh=1 — сбросить кэш (кнопка «Обновить» в пикере)
export async function GET(req: Request) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sc_session=([^;]+)/);
  const session = m ? verifySession(decodeURIComponent(m[1])) : null;
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const channel = (url.searchParams.get("channel") || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const refresh = url.searchParams.get("refresh") === "1";

  const data = await loadEmotes(channel, refresh);
  return Response.json(data);
}
