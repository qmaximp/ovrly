export const dynamic = "force-dynamic";

import { json, sessionFrom } from "@/lib/api";
import { loadEmotes } from "@/lib/emotes";

// Смайлики канала: Twitch (личный набор автора + канальные + глобальные),
// 7TV, BetterTTV, FrankerFaceZ. Вся логика — в lib/emotes.ts.
// ?refresh=1 — сбросить кэш (кнопка «Обновить» в пикере)
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const channel = (url.searchParams.get("channel") || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    // имя канала Twitch: буквы/цифры/подчёркивание, до 25 символов.
    // Остальное отсекаем, чтобы не подставлять в адреса внешних API.
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 25);
  const refresh = url.searchParams.get("refresh") === "1";

  const data = await loadEmotes(channel, refresh);
  return json(data);
}
