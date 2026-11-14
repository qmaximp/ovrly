import crypto from "crypto";
import { readLinks, writeLinks } from "@/lib/links";
import { json, sessionFrom } from "@/lib/api";

// сохранённые ссылки аккаунта (переживают F5 и рестарт, пока жив файл)
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const saved = (await readLinks())[session.login];
  return json({ token: saved?.token ?? null });
}

// генерация новой ссылки (старая перестаёт действовать); токены смайликов не трогаем
export async function POST(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const data = await readLinks();
  const token = crypto.randomBytes(8).toString("hex");
  data[session.login] = {
    ...data[session.login],
    token,
    updatedAt: new Date().toISOString(),
  };
  await writeLinks(data);
  return json({ token });
}
