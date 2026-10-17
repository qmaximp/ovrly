// Общие Helix-хелперы (используются роутами emotes и twitch-live)

export async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

// app access token для Helix (действует час, кэшируем)
let appToken: { token: string; expires: number } | null = null;
export async function getAppToken(): Promise<string | null> {
  const cid = process.env.TWITCH_CLIENT_ID;
  const sec = process.env.TWITCH_CLIENT_SECRET;
  if (!cid || !sec) return null;
  if (appToken && appToken.expires > Date.now() + 60000) return appToken.token;
  const res = await safe(() =>
    fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: "client_credentials" }),
    }).then((r) => r.json())
  );
  if (!res?.access_token) return null;
  appToken = { token: res.access_token, expires: Date.now() + (res.expires_in ?? 3600) * 1000 };
  return appToken.token;
}

export async function helix(path: string): Promise<any | null> {
  const token = await getAppToken();
  const cid = process.env.TWITCH_CLIENT_ID;
  if (!token || !cid) return null;
  const res = await safe(() =>
    fetch(`https://api.twitch.tv/helix/${path}`, {
      headers: { "Client-Id": cid, Authorization: `Bearer ${token}` },
    })
  );
  if (!res || !res.ok) return null;
  return res.json();
}

// логин -> аватар профиля Twitch. Кабинет опрашивает доступы каждые 5 секунд,
// поэтому кэшируем ответы Helix: успешные — на час, промахи — на 10 минут.
// null аватара означает «показывай букву», картинка не обязательна для работы.
const avatarCache = new Map<string, { url: string | null; expires: number }>();
const AVATAR_TTL_MS = 60 * 60 * 1000;
const AVATAR_MISS_TTL_MS = 10 * 60 * 1000;
const AVATAR_ERROR_TTL_MS = 60 * 1000;

export async function getTwitchAvatars(
  logins: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(
    new Set(
      logins
        .map((login) => String(login || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const result: Record<string, string> = {};
  const missing: string[] = [];
  const now = Date.now();

  for (const login of unique) {
    const cached = avatarCache.get(login);
    if (cached && cached.expires > now) {
      if (cached.url) result[login] = cached.url;
    } else {
      missing.push(login);
    }
  }

  // Helix отдаёт до 100 логинов за запрос; берём 50, чтобы не упереться в длину URL
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const params = new URLSearchParams();
    for (const login of chunk) params.append("login", login);
    const data = await helix(`users?${params.toString()}`);
    if (!data) {
      // временная ошибка Helix/токена: не долбим API каждые 5 секунд
      for (const login of chunk) {
        avatarCache.set(login, { url: null, expires: now + AVATAR_ERROR_TTL_MS });
      }
      continue;
    }
    const found = new Map<string, string>();
    for (const user of Array.isArray(data.data) ? data.data : []) {
      if (user?.login && user?.profile_image_url) {
        found.set(String(user.login).toLowerCase(), String(user.profile_image_url));
      }
    }
    for (const login of chunk) {
      const url = found.get(login) ?? null;
      if (url) result[login] = url;
      avatarCache.set(login, {
        url,
        expires: now + (url ? AVATAR_TTL_MS : AVATAR_MISS_TTL_MS),
      });
    }
  }

  return result;
}

// логин -> id канала (Helix, при отсутствии ключей — публичный ivr.fi).
// Промахи тоже кэшируем: без этого несуществующий/непривязанный канал заново
// дёргал Helix и ivr.fi на каждый запрос смайликов
const userIdCache = new Map<string, string>();
const userIdMiss = new Map<string, number>();
const MISS_TTL_MS = 5 * 60 * 1000;

export async function twitchUserId(login: string): Promise<string | null> {
  const key = login.toLowerCase();
  const hit = userIdCache.get(key);
  if (hit) return hit;
  const missAt = userIdMiss.get(key);
  if (missAt && Date.now() - missAt < MISS_TTL_MS) return null;
  const helixData = await helix(`users?login=${encodeURIComponent(key)}`);
  const id = helixData?.data?.[0]?.id ?? null;
  if (id) { userIdCache.set(key, id); userIdMiss.delete(key); return id; }
  const ivr = await safe(() =>
    fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(key)}`).then((r) => r.json())
  );
  if (Array.isArray(ivr) && ivr[0]?.id) {
    userIdCache.set(key, ivr[0].id);
    userIdMiss.delete(key);
    return ivr[0].id;
  }
  userIdMiss.set(key, Date.now());
  return null;
}
