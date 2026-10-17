import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notRegisteredScreen, isValidRoomToken } from "@/lib/links";
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
  searchParams?: Promise<{ invite?: string }>;
}) {
  // Next 16: cookies(), headers() и searchParams асинхронные — их нужно дожидаться
  const c = (await cookies()).get("sc_session");
  const session = c ? verifySession(c.value) : null;
  if (!session) return notRegisteredScreen();

  // ?invite=<токен> приходит после входа по ссылке стримера — кабинет открывается
  // сразу на вкладке «Доступ к панели», где видно приглашение (выдаётся только по нику)
  const inviteToken = (await searchParams)?.invite;
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
      token={tokenForLogin(session.login)}
      origin={`${proto}://${host}`}
      defaultTab={cameFromRoomLink ? "access" : "links"}
      isAdmin={isAdminLogin(session.login)}
    />
  );
}
