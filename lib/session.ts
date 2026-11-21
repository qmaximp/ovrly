import crypto from "crypto";

// Подпись сессий. Без явного секрета нельзя запускаться в проде: иначе любой
// может подделать cookie с чужим (в т.ч. админским) логином. В dev/локально
// секрет случайный на процесс (globalThis — общий для всех бандлов Next).
const explicitSecret = process.env.SESSION_SECRET || process.env.TWITCH_CLIENT_SECRET
if (!explicitSecret && process.env.NODE_ENV === "production") {
  throw new Error("SESSION_SECRET (или TWITCH_CLIENT_SECRET) обязателен в production");
}
const g = globalThis as typeof globalThis & { __ovrlySessionSecret?: string };
export const SECRET =
  explicitSecret || (g.__ovrlySessionSecret ??= crypto.randomBytes(32).toString("hex"));

export interface TwitchSession {
  // логин Twitch; пустая строка у аккаунтов, зарегистрированных по почте
  // и ещё не привязавших Twitch
  login: string;
  // id учётной записи Ovrly (data/users или таблица users)
  uid?: string;
  email?: string;
  display_name: string;
  avatar?: string;
  // user-токен Helix — нужен для канальных смайликов (chat/emotes/channel)
  access_token?: string;
  token_expires?: number; // ms epoch
  // когда выдана cookie (ms epoch). Старые cookie без iat не ломаем,
  // но новые живут не дольше SESSION_MAX_AGE_MS.
  iat?: number;
}

// Twitch привязан к аккаунту: только тогда доступны ссылки комнаты, панель
// и всё, что исторически завязано на логин Twitch.
export function hasTwitch(session: TwitchSession | null | undefined): session is TwitchSession {
  return !!session && typeof session.login === "string" && session.login.length > 0;
}

// подписанная cookie-сессия (payload.sig), без серверного хранилища
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000;

export function signSession(data: TwitchSession): string {
  const payload = Buffer.from(
    JSON.stringify({ ...data, iat: Date.now() }),
  ).toString("base64url");
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
    if (typeof data.login !== "string" && typeof data.uid !== "string") return null;
    // Cookie с истёкшим iat не принимаем: иначе украденная cookie живёт вечно,
    // ведь Max-Age действует только в браузере.
    if (typeof data.iat === "number" && Date.now() - data.iat > SESSION_MAX_AGE_MS) {
      return null;
    }
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

// origin из заголовков запроса (учитывает прокси Render).
// APP_ORIGIN/NEXTAUTH_URL-like переменная приоритетнее: Host приходит от клиента,
// а он попадает в redirect_uri OAuth, поэтому доверять ему без проверки нельзя.
export function getOrigin(req: Request): string {
  const explicit = (process.env.APP_ORIGIN || process.env.PUBLIC_ORIGIN || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const rawHost = (req.headers.get("host") || "localhost:3000").trim();
  // отсекаем всё, что не похоже на host[:port] (защита от подстановки путей)
  const host = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(rawHost) ? rawHost : "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

// Куда вернуть пользователя после входа: только относительный путь внутри сайта.
// «//evil.com» и «/\evil.com» браузер трактует как чужой хост, поэтому режем оба.
export function safeNextPath(raw: string | null | undefined, fallback = "/cabinet"): string {
  const value = String(raw || "").trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}

// относительный редирект — порт берётся из запроса, а не из дефолта Next
export function seeOther(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: path } });
}
