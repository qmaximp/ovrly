import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { getOrigin, seeOther, signSession, tokenForLogin } from "@/lib/session";
import { readLinks, writeLinks, readOwner, writeOwner } from "@/lib/links";
import { LEGAL_VERSION } from "@/lib/legal";

export async function GET(req: Request) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.headers.get("cookie")?.match(/sc_oauth_state=([^;]+)/)?.[1];

  if (!clientId || !clientSecret || !code) {
    return seeOther("/?error=auth");
  }
  if (!state || !expectedState || state !== expectedState) {
    return seeOther("/?error=state");
  }

  const redirectUri = process.env.TWITCH_REDIRECT_URI || `${getOrigin(req)}/api/auth/twitch/callback`;

  const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const token = await tokenRes.json();
  if (!token.access_token) {
    return seeOther("/?error=token");
  }

  const userRes = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${token.access_token}` },
  });
  const userData = await userRes.json();
  const u = userData?.data?.[0];
  if (!u) {
    return seeOther("/?error=user");
  }

  const session: import("@/lib/session").TwitchSession = {
    login: u.login,
    display_name: u.display_name,
    avatar: u.profile_image_url,
    access_token: token.access_token,
    token_expires: Date.now() + (token.expires_in ?? 14400) * 1000,
  };

  // сохраняем токен на диск: канал-владелец панели сможет отдавать свои канальные смайлики,
  // даже когда панель открыта без входа (панелью пользуется модератор по room-ссылке)
  const links = await readLinks();
  links[u.login] = {
    ...(links[u.login] ?? { token: tokenForLogin(u.login), updatedAt: new Date().toISOString() }),
    userToken: token.access_token,
    userTokenExpires: session.token_expires!,
    refreshToken: token.refresh_token ?? links[u.login]?.refreshToken,
  };
  await writeLinks(links);

  // первый вошедший аккаунт считается владельцем панели
  if (!(await readOwner())) await writeOwner(u.login);

  // Журнал согласий: доказываем, что до OAuth пользователь поставил обе
  // отметки (соглашение + обработка ПДн). Данные — минимум для доказывания:
  // логин, время, версия документов, IP и user-agent. Не мешает входу.
  try {
    const consent = req.headers.get("cookie")?.match(/(?:^|;\s*)sc_consent=([^;]+)/)?.[1];
    if (consent === LEGAL_VERSION) {
      const dir = path.join(process.cwd(), "data");
      await mkdir(dir, { recursive: true });
      const ip =
        (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        req.headers.get("x-real-ip") ||
        "";
      await appendFile(
        path.join(dir, "consents.jsonl"),
        JSON.stringify({
          event: "login",
          at: new Date().toISOString(),
          login: u.login,
          version: LEGAL_VERSION,
          docs: ["terms", "privacy", "consent"],
          ip,
          ua: (req.headers.get("user-agent") || "").slice(0, 300),
        }) + "\n",
        "utf8",
      );
    }
  } catch {
    // журнал не должен ломать вход: сбой записи игнорируем
  }

  // возврат на исходную страницу (по умолчанию кабинет)
  const nextRaw = req.headers.get("cookie")?.match(/(?:^|;\s*)sc_next=([^;]+)/)?.[1];
  let next = "/cabinet";
  if (nextRaw) {
    const decoded = decodeURIComponent(nextRaw);
    if (decoded.startsWith("/") && !decoded.startsWith("//")) next = decoded;
  }

  const res = seeOther(next);
  // Secure только на https: иначе на локальном http браузер отбросил бы cookie
  const secure = getOrigin(req).startsWith("https:") ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `sc_session=${signSession(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`,
  );
  res.headers.append("Set-Cookie", "sc_oauth_state=; Path=/; Max-Age=0");
  res.headers.append("Set-Cookie", "sc_next=; Path=/; Max-Age=0");
  return res;
}
