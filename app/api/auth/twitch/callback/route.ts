import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { getOrigin, safeNextPath, seeOther, signSession, SESSION_MAX_AGE_S, tokenForLogin, verifySession } from "@/lib/session";
import { sessionForUser } from "@/lib/auth";
import { readLinks, writeLinks, readOwner, writeOwner } from "@/lib/links";
import { LEGAL_VERSION } from "@/lib/legal";
import { syncStreamer } from "@/lib/streamers";
import { createUser, findUserById, findUserByTwitch, touchUserLogin, updateUser } from "@/lib/users";

type TwitchSessionShape = import("@/lib/session").TwitchSession;

export async function GET(req: Request) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = req.headers.get("cookie") || "";
  const stateCookie = cookie.match(/sc_oauth_state=([^;]+)/)?.[1] || "";
  // state.<mode> — режим поездки задаёт сам запрос авторизации
  const [expectedState, mode] = stateCookie.split(".");
  const linkMode = mode === "link";

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

  const twitch: TwitchSessionShape = {
    login: u.login,
    display_name: u.display_name,
    avatar: u.profile_image_url,
    access_token: token.access_token,
    token_expires: Date.now() + (token.expires_in ?? 14400) * 1000,
  };

  // Привязка Twitch к аккаунту, созданному по почте. Сессию берём из cookie:
  // state защищает от подмены, cookie sc_link выставляется только из кабинета.
  let session: TwitchSessionShape = twitch;
  let linked = false;
  if (linkMode) {
    const current = verifySession(
      cookie.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1],
    );
    if (!current?.uid) {
      return seeOther("/?auth=1&next=%2Fcabinet");
    }
    try {
      const me = await findUserById(current.uid);
      if (!me) return seeOther("/cabinet?twitch=error");
      if (me.twitchLogin && me.twitchLogin === u.login) {
        // уже привязан этот же аккаунт — просто обновляем сессию
        session = sessionForUser(me, {
          login: u.login,
          display_name: u.display_name || me.displayName,
          avatar: me.avatar || u.profile_image_url,
          access_token: token.access_token,
          token_expires: twitch.token_expires,
        });
        linked = true;
      } else if (me.twitchLogin) {
        return seeOther("/cabinet?twitch=already");
      } else {
        const other = await findUserByTwitch(u.login);
        if (other && other.id !== me.id) {
          return seeOther("/cabinet?twitch=exists");
        }
        await updateUser(me.id, {
          twitchLogin: u.login,
          displayName: u.display_name || me.displayName,
          avatar: me.avatar || u.profile_image_url,
          lastLoginAt: new Date().toISOString(),
        });
        session = sessionForUser(me, {
          login: u.login,
          display_name: u.display_name || me.displayName,
          avatar: me.avatar || u.profile_image_url,
          access_token: token.access_token,
          token_expires: twitch.token_expires,
        });
        linked = true;
      }
    } catch (error) {
      console.error("[ovrly] не удалось привязать Twitch", error);
      return seeOther("/cabinet?twitch=error");
    }
  } else {
    // Обычный вход: находим или заводим учётную запись (старые аккаунты
    // созданы до появления паролей — у них нет password_hash).
    try {
      let user = await findUserByTwitch(u.login);
      if (!user) {
        user = await createUser({
          twitchLogin: u.login,
          displayName: u.display_name || u.login,
          avatar: u.profile_image_url,
          lastLoginAt: new Date().toISOString(),
        });
      } else {
        await touchUserLogin(user.id);
      }
      session = sessionForUser(user, {
        login: u.login,
        display_name: u.display_name || user.displayName,
        avatar: u.profile_image_url || user.avatar || undefined,
        access_token: token.access_token,
        token_expires: twitch.token_expires,
      });
    } catch (error) {
      // if DB недоступна, не ломаем вход: сессия останется без uid,
      // кабинет продолжит работать как раньше (по логину Twitch)
      console.error("[ovrly] не удалось сохранить пользователя", error);
    }
  }

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
    const consent = cookie.match(/(?:^|;\s*)sc_consent=([^;]+)/)?.[1];
    if (linked || consent === LEGAL_VERSION) {
      const dir = path.join(process.cwd(), "data");
      await mkdir(dir, { recursive: true });
      const ip =
        (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
        req.headers.get("x-real-ip") ||
        "";
      await appendFile(
        path.join(dir, "consents.jsonl"),
        JSON.stringify({
          event: linked ? "twitch_link" : "login",
          at: new Date().toISOString(),
          login: u.login,
          ...(session.uid ? { uid: session.uid } : {}),
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

  // карусель на главной: сохраняем число подписчиков и аватар. Сбой не должен
  // ломать вход — просто не попадёт в карусель до следующего входа.
  try {
    await syncStreamer({ login: u.login, displayName: u.display_name || u.login });
  } catch {
    // ignore
  }

  // возврат на исходную страницу (по умолчанию кабинет)
  const nextRaw = cookie.match(/(?:^|;\s*)sc_next=([^;]+)/)?.[1];
  const next = safeNextPath(nextRaw, "/cabinet");

  const res = seeOther(next);
  // Secure только на https: иначе на локальном http браузер отбросил бы cookie
  const secure = getOrigin(req).startsWith("https:") ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `sc_session=${signSession(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`,
  );
  res.headers.append("Set-Cookie", "sc_oauth_state=; Path=/; Max-Age=0");
  res.headers.append("Set-Cookie", "sc_next=; Path=/; Max-Age=0");
  res.headers.append("Set-Cookie", "sc_link=; Path=/; Max-Age=0");
  return res;
}
