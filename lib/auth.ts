import type { NextResponse } from 'next/server'
import {
	getOrigin,
	signSession,
	SESSION_MAX_AGE_S,
	type TwitchSession,
} from './session'
import type { User } from './users'

// Общие помощники для новых роутов входа/регистрации.

export function normalizeEmail(raw: unknown): string {
	return String(raw ?? '').trim().toLowerCase()
}

export function isEmail(email: string): boolean {
	if (!email || email.length > 254) return false
	if (/\s/.test(email)) return false
	return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email)
}

// Проверка Origin для POST. SameSite=Lax уже отсекает межсайтовые POST, но
// дополнительная проверка ловит старые браузеры и явные CSRF-попытки.
//
// Если Origin не пришёл, смотрим Sec-Fetch-Site (его принудительно ставит
// браузер и подделать из JS нельзя). Запрос без обоих заголовков — не из
// браузера: отклоняем, чтобы нельзя было «тихо» дернуть API с чужой страницы.
export function sameOrigin(req: Request): boolean {
	const origin = req.headers.get('origin')
	const site = req.headers.get('sec-fetch-site')
	if (site === 'cross-site') return false
	if (origin) return origin === getOrigin(req)
	return site === 'same-origin' || site === 'same-site'
}

export function sessionForUser(
	user: User,
	extra: Partial<TwitchSession> = {},
): TwitchSession {
	return {
		login: user.twitchLogin ?? '',
		uid: user.id,
		email: user.email ?? undefined,
		display_name: user.displayName,
		avatar: user.avatar ?? undefined,
		...extra,
	}
}

export function setSessionCookie(
	res: NextResponse,
	req: Request,
	session: TwitchSession,
): void {
	res.cookies.set('sc_session', signSession(session), {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: SESSION_MAX_AGE_S,
		secure: getOrigin(req).startsWith('https:'),
	})
}
