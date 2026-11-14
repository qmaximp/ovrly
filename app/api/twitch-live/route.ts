export const dynamic = "force-dynamic";

import { json, sessionFrom } from "@/lib/api";
import { helix, safe } from "@/lib/twitch";

// Статус канала: живой ли стрим прямо сейчас.
// Панель опрашивает это, чтобы перезагрузить превью-плеер, когда стример начал стрим
// (иначе плеер, загруженный в оффлайне, так и остаётся «на паузе»).
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const channel = (new URL(req.url).searchParams.get("channel") || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 25);
  if (!channel) return json({ error: "channel required" }, 400);
  const data = await safe(() => helix(`streams?user_login=${encodeURIComponent(channel)}`));
  const stream = data?.data?.[0] ?? null;
  // live: null — статус неизвестен (нет ключей/ошибка сети): клиент ничего не меняет
  return json({
    live: data ? !!stream : null,
    startedAt: stream?.started_at ?? null,
  });
}
