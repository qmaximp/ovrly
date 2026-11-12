import * as storage from "./storage";

// Данные ссылок и владельца живут в lib/storage: Postgres при наличии
// DATABASE_URL, иначе JSON в data/ (локальная разработка).
export type LinksData = Record<string, {
  token: string;
  updatedAt: string;
  // user-токен Twitch для канальных смайликов (заполняется при OAuth-входе)
  userToken?: string;
  userTokenExpires?: number;
  refreshToken?: string;
}>;

export async function readLinks(): Promise<LinksData> {
  const rows = await storage.getLinks();
  const out: LinksData = {};
  for (const row of rows) {
    out[row.login] = {
      token: row.token,
      updatedAt: row.updatedAt ?? new Date().toISOString(),
      ...(row.userToken ? { userToken: row.userToken } : {}),
      ...(row.userTokenExpires ? { userTokenExpires: row.userTokenExpires } : {}),
      ...(row.refreshToken ? { refreshToken: row.refreshToken } : {}),
    };
  }
  return out;
}

export async function writeLinks(data: LinksData): Promise<void> {
  await storage.saveLinks(data);
}

// токен валиден, только если совпадает с последним сгенерированным;
// прямой доступ без ?room= не блокируем
export async function isValidRoomToken(
  room: string | undefined | null,
): Promise<boolean> {
  if (!room) return true;
  return !!(await storage.findOwnerByToken(room));
}

// владелец панели — первый аккаунт, вошедший через Twitch; определяет канал смайликов/превью
export async function readOwner(): Promise<string | null> {
  return storage.getOwner();
}

export async function writeOwner(login: string): Promise<void> {
  await storage.setOwner(login);
}

// Общий каркас служебных экранов: та же тема, что у 404/500, поэтому
// «нет доступа» и «ссылка отозвана» не выглядят чужими страницами.
function Notice({
  icon,
  title,
  children,
  actions,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <main className="err-shell">
      <div className="err-grid" aria-hidden="true" />
      <div className="err-card">
        <div className="err-icon" aria-hidden="true">{icon}</div>
        <h1 className="err-title">{title}</h1>
        <p className="err-text">{children}</p>
        <div className="err-actions">{actions}</div>
      </div>
    </main>
  )
}

const TwitchMark = ({ size = 26 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="#fff" width={size} height={size} aria-hidden="true">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z" />
  </svg>
)

// экран «нет регистрации»: доступ только после входа через Twitch.
// next — куда вернуть пользователя после успешного входа (относительный путь)
export function notRegisteredScreen(next?: string): React.ReactNode {
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/cabinet";
  const loginHref = `/api/auth/twitch?next=${encodeURIComponent(safeNext)}`;
  return (
    <Notice
      icon={<span className="err-brand"><TwitchMark /></span>}
      title="Вы не зарегистрированы"
      actions={
        <a href={loginHref} className="btn" style={{ background: "#9146FF" }}>
          <TwitchMark size={20} />
          Войти через Twitch
        </a>
      }
    >
      Вход через Twitch не выполнен — пока нет доступа к этой странице. Войдите,
      чтобы получить кабинет и ссылки для панели.
    </Notice>
  );
}

// экран «ссылка недействительна» вместо приложения
export function invalidLinkScreen(): React.ReactNode {
  return (
    <Notice
      icon="🔗"
      title="Ссылка недействительна"
      actions={<a href="/" className="btn btn-ghost">На главную</a>}
    >
      Эта ссылка была отозвана или заменена новой. Попросите свежую ссылку в личном кабинете.
    </Notice>
  );
}

// экран «доступ временно отключён стримером» (модератор, попавший под suspend)
export function accessSuspendedScreen(ownerLogin: string): React.ReactNode {
  return (
    <Notice
      icon="🔒"
      title="Доступ временно отключён"
      actions={<a href="/cabinet" className="btn btn-primary">В личный кабинет</a>}
    >
      Стример <strong>{ownerLogin}</strong> приостановил ваш доступ к панели.
      Напишите ему, чтобы вернуть.
    </Notice>
  );
}

// экран «приглашения нет»: доступ к панели выдаётся только по нику Twitch
// через кабинет стримера — угаданная/переданная ссылка сама доступ не даёт
export function noInviteScreen(ownerLogin: string): React.ReactNode {
  return (
    <Notice
      icon="🚪"
      title="У вас нет приглашения"
      actions={<a href="/cabinet" className="btn btn-primary">В личный кабинет</a>}
    >
      Стример <strong>{ownerLogin}</strong> выдаёт доступ к панели только по нику Twitch.
      Попросите его пригласить вас во вкладке «Доступ к панели».
    </Notice>
  );
}
