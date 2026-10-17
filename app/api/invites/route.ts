import { readLinks } from "@/lib/links";
import {
  acceptInvite,
  ensurePendingInvite,
  getInviteStatus,
  listInvitesFor,
  listModerators,
  removeModerator,
  setModeratorSuspended,
} from "@/lib/invites";
import { getTwitchAvatars, safe, twitchUserId } from "@/lib/twitch";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function sessionFrom(req: Request) {
  return verifySession(req.headers.get("cookie")?.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1]);
}

// все доступы текущего аккаунта и список модераторов его собственной панели
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  const links = await readLinks();

  const invites = (await listInvitesFor(session.login)).map(({ owner, entry }) => ({
    owner,
    status: entry.status,
    suspended: entry.suspended,
    // ссылка строится из АКТУАЛЬНОГО токена владельца — после регенерации она меняется сама
    token: links[owner]?.token ?? null,
  }));
  const moderators = await listModerators(session.login);

  // аватарки обоих списков тянем одним батчем; при сбое Helix остаются буквы
  const avatars =
    (await safe(() =>
      getTwitchAvatars([
        ...invites.map((i) => i.owner),
        ...moderators.map((m) => m.login),
      ]),
    )) ?? {};
  const avatarFor = (login: string) => avatars[login.toLowerCase()] ?? null;

  return json({
    invites: invites.map((i) => ({ ...i, avatar: avatarFor(i.owner) })),
    moderators: moderators.map((m) => ({ ...m, avatar: avatarFor(m.login) })),
    roomToken: links[session.login]?.token ?? null,
  });
}

export async function POST(req: Request) {
  const session = sessionFrom(req);
  if (!session) return json({ error: "unauthorized" }, 401);
  let body: { action?: string; login?: string; owner?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  if (body.action === "invite") {
    const login = (body.login ?? "").trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9_]{3,25}$/.test(login)) return json({ error: "Некорректный ник Twitch" }, 400);
    if (login === session.login) return json({ error: "Нельзя пригласить самого себя" }, 400);
    // проверяем, что аккаунт существует в Twitch (если есть ключи API)
    if (process.env.TWITCH_CLIENT_ID) {
      const uid = await safe(() => twitchUserId(login));
      if (!uid) return json({ error: "Пользователь Twitch не найден" }, 400);
    }
    await ensurePendingInvite(session.login, login);
    return json({ ok: true });
  }

  if (body.action === "accept") {
    const owner = body.owner ?? "";
    if (!(await getInviteStatus(owner, session.login))) return json({ error: "Приглашение не найдено" }, 404);
    await acceptInvite(owner, session.login);
    return json({ ok: true });
  }

  // модератор сам отклоняет приглашение или отсоединяется от панели
  if (body.action === "decline") {
    const owner = body.owner ?? "";
    if (!(await getInviteStatus(owner, session.login))) return json({ error: "Приглашение не найдено" }, 404);
    await removeModerator(owner, session.login);
    return json({ ok: true });
  }

  // управление доступом — только владелец комнаты
  if (body.action === "suspend" || body.action === "resume" || body.action === "revoke") {
    const login = (body.login ?? "").trim().toLowerCase();
    if (!login || !(await getInviteStatus(session.login, login))) return json({ error: "Модератор не найден" }, 404);
    if (body.action === "suspend") await setModeratorSuspended(session.login, login, true);
    if (body.action === "resume") await setModeratorSuspended(session.login, login, false);
    if (body.action === "revoke") await removeModerator(session.login, login);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
}
