import { NextResponse } from "next/server";
import { getOrigin, randomState, safeNextPath, seeOther, verifySession } from "@/lib/session";
import { isConsentVersion } from "@/lib/legal";

export async function GET(req: Request) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId || !process.env.TWITCH_CLIENT_SECRET) {
    return seeOther("/?error=config");
  }

  const params = new URL(req.url).searchParams;
  // link=1 — привязка Twitch к уже существующему аккаунту из кабинета.
  const link = params.get("link") === "1";
  const nextSafe = safeNextPath(params.get("next"), "/cabinet");
  const cookie = req.headers.get("cookie") || "";

  if (link) {
    // Привязка доступна только вошедшему пользователю: иначе это обычный вход.
    const session = verifySession(cookie.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1]);
    if (!session?.uid) {
      return seeOther("/?auth=1&next=%2Fcabinet");
    }
  } else {
    // Без явного согласия не начинаем OAuth: до этого момента никакие данные
    // пользователя (включая Twitch-профиль) не собираются. Согласие ставится
    // чекбоксом на лендинге и живёт в cookie sc_consent.
    const consent = cookie.match(/(?:^|;\s*)sc_consent=([^;]+)/)?.[1];
    if (!isConsentVersion(consent)) {
      return seeOther(`/?consent=1&next=${encodeURIComponent(nextSafe)}`);
    }
  }

  const redirectUri = process.env.TWITCH_REDIRECT_URI || `${getOrigin(req)}/api/auth/twitch/callback`;
  const state = randomState();
  const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  // email не запрашиваем: он не используется, а 152-ФЗ требует минимизации.
  // moderation:read — только для импорта списка модераторов канала.
  authUrl.searchParams.set("scope", "user:read:emotes moderation:read");
  authUrl.searchParams.set("state", state);
  const res = NextResponse.redirect(authUrl.toString());
  // Secure только на https (на http://localhost браузер cookie с Secure отбросил бы)
  const secure = getOrigin(req).startsWith("https:");
  // Режим поездки храним в самом state: отдельная cookie sc_link жила 10 минут
  // и после неудачной привязки превращала следующий обычный вход в привязку.
  res.cookies.set("sc_oauth_state", `${state}.${link ? "link" : "login"}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure });
  res.cookies.set("sc_next", nextSafe, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure });
  // подчищаем флаг от старой версии, если он ещё висит в браузере
  res.cookies.set("sc_link", "", { path: "/", maxAge: 0 });
  return res;
}
