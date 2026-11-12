import crypto from "crypto";

// Подпись сессий. Без явного секрета нельзя запускаться в проде: иначе любой
// может подделать cookie с чужим (в т.ч. админским) логином. В dev/локально
// секрет случайный на процесс (globalThis — общий для всех бандлов Next).
const explicitSecret = process.env.SESSION_SECRET || process.env.TWITCH_CLIENT_SECRET
if (!explicitSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET (или TWITCH_CLIENT_SECRET) обязателен в production");
}
const g = globalThis as typeof globalThis & { __ovrlySessionSecret?: string };
const SECRET =
  explicitSecret || (g.__ovrlySessionSecret ??= crypto.randomBytes(32).toString("hex"));

export interface TwitchSession {
  login: string;
  display_name: string;
  avatar?: string;
  // user-токен Helix — нужен для канальных смайликов (chat/emotes/channel)
  access_token?: string;
  token_expires?: number; // ms epoch
}

// подписанная cookie-сессия (payload.sig), без серверного хранилища
export function signSession(data: TwitchSession): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(cookie: string | undefined): TwitchSession | null {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.login !== "string") return null;
    return data as TwitchSession;
  } catch {
    return null;
  }
}

// стабильный токен ссылок для аккаунта (не меняется между сессиями)
export function tokenForLogin(login: string): string {
  return crypto.createHmac("sha256", SECRET).update("room:" + login).digest("hex").slice(0, 12);
}

export function randomState(): string {
  return crypto.randomBytes(8).toString("hex");
}

// origin из заголовков запроса (учитывает прокси Render)
export function getOrigin(req: Request): string {
  const host = req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

// относительный редирект — порт берётся из запроса, а не из дефолта Next
export function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}
