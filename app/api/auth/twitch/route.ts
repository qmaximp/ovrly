import { NextResponse } from "next/server";
import { getOrigin, randomState, seeOther } from "@/lib/session";
import { LEGAL_VERSION } from "@/lib/legal";

export async function GET(req: Request) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId || !process.env.TWITCH_CLIENT_SECRET) {
    return seeOther("/?error=config");
  }

  // куда вернуть пользователя после входа (только относительные пути внутри сайта)
  const next = new URL(req.url).searchParams.get("next");
  const nextSafe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/cabinet";

  // Без явного согласия не начинаем OAuth: до этого момента никакие данные
  // пользователя (включая Twitch-профиль) не собираются. Согласие ставится
  // чекбоксом на лендинге и живёт в cookie sc_consent.
  const consent = req.headers.get("cookie")?.match(/(?:^|;\s*)sc_consent=([^;]+)/)?.[1];
  if (consent !== LEGAL_VERSION) {
    return seeOther(`/?consent=1&next=${encodeURIComponent(nextSafe)}`);
  }

  const redirectUri = process.env.TWITCH_REDIRECT_URI || `${getOrigin(req)}/api/auth/twitch/callback`;
  const state = randomState();
  const authUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  // email не запрашиваем: он не используется, а 152-ФЗ требует минимизации
  authUrl.searchParams.set("scope", "user:read:emotes");
  authUrl.searchParams.set("state", state);
  const res = NextResponse.redirect(authUrl.toString());
  // Secure только на https (на http://localhost браузер cookie с Secure отбросил бы)
  const secure = getOrigin(req).startsWith("https:");
  res.cookies.set("sc_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure });
  res.cookies.set("sc_next", nextSafe, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600, secure });
  return res;
}
