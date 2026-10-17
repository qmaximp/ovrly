import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import PanelClient from "@/components/PanelClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { isAdminLogin } from "@/lib/admin";
import {
  accessSuspendedScreen,
  invalidLinkScreen,
  isValidRoomToken,
  noInviteScreen,
  notRegisteredScreen,
} from "@/lib/links";
import { findOwnerByToken, getInviteStatus } from "@/lib/invites";
import { verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Заголовок вкладки: у модератора бывает открыто несколько панелей разных стримеров —
// по вкладке видно, какая чья. absolute — чтобы не подставлялся шаблон "%s · Ovrly"
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ room?: string }>;
}): Promise<Metadata> {
  const room = (await searchParams)?.room;
  const owner = room ? findOwnerByToken(room) : null;
  return { title: { absolute: owner ? `Ovrly · ${owner}` : "Ovrly" } };
}

// Next 16: cookies() и searchParams асинхронные — их нужно дожидаться
export default async function Panel({
	searchParams,
}: {
	searchParams?: Promise<{ room?: string; ghost?: string }>;
}) {
	const params = await searchParams;
	const room = params?.room;
	// чистая ссылка /panel закрыта: панель открывается только по ссылке с токеном комнаты
	if (!room || !isValidRoomToken(room)) {
		return invalidLinkScreen();
	}

	const session = verifySession((await cookies()).get("sc_session")?.value);
	// не авторизован — после входа попадёт в кабинет (приглашение выдаёт стример по нику)
	if (!session) return notRegisteredScreen(`/cabinet?invite=${encodeURIComponent(room)}`);

	const owner = findOwnerByToken(room);
	if (!owner) return invalidLinkScreen();

	// невидимый вход: параметр учитывается только для администраторов. Остальным
	// он ничего не даёт — сервер тоже перепроверяет ник из подписанной сессии
	const ghost = params?.ghost === "1" && isAdminLogin(session.login);

	// владелец комнаты — доступ всегда; администратор в невидимом режиме — тоже
	if (owner === session.login || ghost) {
		return (
			<ErrorBoundary>
				<PanelClient
				channel={owner}
				room={room}
				userLogin={session.login}
				ghost={ghost}      />
			</ErrorBoundary>
		);
	}

  // модератор: приглашение создаётся ТОЛЬКО стримером по нику в кабинете.
  // Просто открыв ссылку (даже угадав токен), доступ не получишь
  const entry = getInviteStatus(owner, session.login);
  if (!entry) {
    return noInviteScreen(owner);
  }
  if (entry.status === "pending") {
    // приглашён по нику — принимает в кабинете, сразу на вкладке «Доступ к панели»
    redirect(`/cabinet?invite=${encodeURIComponent(room)}`);
  }
  if (entry.suspended) {
    return accessSuspendedScreen(owner);
  }

  return (
      <ErrorBoundary>
        <PanelClient channel={owner} room={room} userLogin={session.login} />
      </ErrorBoundary>
    );
}
