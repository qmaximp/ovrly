import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { notRegisteredScreen, isValidRoomToken } from "@/lib/links";
import { hasConsent } from "@/lib/legal";
import { tokenForLogin, verifySession } from "@/lib/session";
import CabinetClient from "@/components/CabinetClient";
import { isAdminLogin } from "@/lib/admin";

export const dynamic = "force-dynamic";

// Личный кабинет — не для поисковиков: контент зависит от сессии
export const metadata: Metadata = {
  title: { absolute: "Ovrly · кабинет" },
  robots: { index: false, follow: false },
};

export default async function Cabinet({
  searchParams,
}: {
  searchParams?: Promise<{ invite?: string; twitch?: string }>;
}) {
  // Next 16: cookies(), headers() и searchParams асинхронные — их нужно дожидаться
  const jar = await cookies();
  const c = jar.get("sc_session");
  const session = c ? verifySession(c.value) : null;
  if (!session) return notRegisteredScreen();

  // ?invite=<токен> приходит после входа по ссылке стримера — кабинет открывается
  // сразу на вкладке «Доступ к панели», где видно приглашение (выдаётся только по нику)
  const sp = await searchParams;
  const inviteToken = sp?.invite;
  const twitchStatus = sp?.twitch;

  // Версия документов сменилась — просим согласие заново, прежде чем открыть
  // кабинет. Иначе активная сессия обходила бы окно согласия.
  if (!hasConsent(jar.get("sc_consent")?.value, session.uid)) {
    const back = inviteToken
      ? `/cabinet?invite=${encodeURIComponent(inviteToken)}`
      : "/cabinet";
    redirect(`/?consent=1&next=${encodeURIComponent(back)}`);
  }

  const cameFromRoomLink = !!inviteToken && (await isValidRoomToken(inviteToken));

  const h = await headers();
  const host = h.get("host") || "localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto");
  const proto = forwardedProto || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  return (
    <CabinetClient
      login={session.login}
      displayName={session.display_name}
      avatar={session.avatar}
      email={session.email}
      hasTwitch={!!session.login}
      token={session.login ? tokenForLogin(session.login) : null}
      origin={`${proto}://${host}`}
      defaultTab={cameFromRoomLink ? "access" : "links"}
      twitchStatus={twitchStatus}
      isAdmin={isAdminLogin(session.login)}
    />
  );
}
