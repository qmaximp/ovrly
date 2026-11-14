import crypto from "crypto";
import postgres from "postgres";
import { readLinks, writeLinks } from "@/lib/links";
import { json, sessionFrom } from "@/lib/api";

export const runtime = "nodejs";

let client: ReturnType<typeof postgres> | null = null;
function db() {
  if (!process.env.DATABASE_URL) return null;
  client ||= postgres(process.env.DATABASE_URL, { max: 2 });
  return client;
}

// сохранённые ссылки аккаунта (переживают F5 и рестарт, пока жив файл)
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const saved = (await readLinks())[session.login];
  return json({ token: saved?.token ?? null });
}

// Новая ссылка = новая комната, поэтому переносим в неё элементы старой:
// иначе у человека «пропадает» весь оверлей после нажатия кнопки.
async function copyRoom(from: string, to: string) {
  const sql = db();
  if (!sql || !from || !to || from === to) return;
  try {
    await sql`
      insert into rooms (key, owner, state, updated_at)
      select ${to}, owner, state, now() from rooms where key = ${from}
      on conflict (key) do update set state = excluded.state, updated_at = now()
    `;
    await sql`
      insert into obs_access (room, key_hash, key_enc, created_at)
      select ${to}, key_hash, key_enc, created_at from obs_access where room = ${from}
      on conflict (room) do nothing
    `;
  } catch (e: any) {
    console.error("[links] не удалось перенести комнату:", e?.message || e);
  }
}

// генерация новой ссылки (старая перестаёт действовать), элементы переезжают
export async function POST(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const data = await readLinks();
  const prev = data[session.login]?.token;
  const token = crypto.randomBytes(8).toString("hex");
  data[session.login] = {
    ...data[session.login],
    token,
    updatedAt: new Date().toISOString(),
  };
  await writeLinks(data);
  if (prev) await copyRoom(prev, token);
  return json({ token, moved: Boolean(prev) });
}
