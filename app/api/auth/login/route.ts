import { NextResponse } from 'next/server'
import { clientIp, json, rateLimit, readJson, tooMany } from '@/lib/api'
import { isEmail, normalizeEmail, sameOrigin, sessionForUser, setSessionCookie } from '@/lib/auth'
import { verifyCaptcha } from '@/lib/captcha'
import { burnPasswordCheck, verifyPassword } from '@/lib/passwords'
import { findUserByEmail, findUserByTwitch, touchUserLogin } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Неудачные попытки: после трёх промахов с одного IP просим капчу.
// Счётчик в памяти процесса — этого достаточно для отсечения перебора,
// а сам пароль дополнительно защищён scrypt (дорого перебирать).
const failures = new Map<string, { count: number; first: number }>()
const FAIL_WINDOW = 15 * 60 * 1000

function registerFailure(ip: string): number {
	const now = Date.now()
	const row = failures.get(ip)
	if (!row || now - row.first > FAIL_WINDOW) {
		failures.set(ip, { count: 1, first: now })
		return 1
	}
	row.count += 1
	return row.count
}

function needsCaptcha(ip: string): boolean {
	const row = failures.get(ip)
	if (!row) return false
	if (Date.now() - row.first > FAIL_WINDOW) {
		failures.delete(ip)
		return false
	}
	return row.count >= 3
}

export async function POST(req: Request) {
	if (!sameOrigin(req)) return json({ error: 'Запрос отклонён' }, 403)

	const ip = clientIp(req)
	if (!rateLimit(`login:ip:${ip}`, 20, FAIL_WINDOW)) return tooMany()
	if (needsCaptcha(ip) && !rateLimit(`login:cap:${ip}`, 40, FAIL_WINDOW)) return tooMany()

	let body: Record<string, unknown> | null
	body = await readJson(req)
	if (!body) return json({ error: 'Некорректный запрос' }, 400)

	const identifier = String(body.identifier ?? '').trim()
	const password = String(body.password ?? '')
	const next = typeof body.next === 'string' && body.next.startsWith('/') && !body.next.startsWith('//')
		? body.next
		: '/cabinet'

	if (!identifier || !password || identifier.length > 254 || password.length > 200) {
		return json({ error: 'Введите логин и пароль' }, 400)
	}

	const captchaOn = needsCaptcha(ip)
	if (captchaOn) {
		const token = String(body.captchaToken ?? '')
		const answer = String(body.captchaAnswer ?? '')
		if (!verifyCaptcha(token, answer)) {
			return json(
				{ error: 'Неверный код с картинки', captcha: true },
				400,
			)
		}
	}

	if (!rateLimit(`login:id:${identifier.toLowerCase()}`, 10, FAIL_WINDOW)) {
		return tooMany()
	}

	const isMail = isEmail(identifier)
	const user = isMail
		? await findUserByEmail(normalizeEmail(identifier))
		: await findUserByTwitch(identifier.toLowerCase().replace(/^@/, ''))

	// Одинаковый ответ на «нет пользователя» и «неверный пароль», чтобы нельзя
	// было перебором узнать, какие почты зарегистрированы.
	const FAIL = () => {
		registerFailure(ip)
		return json(
			{
				error: 'Неверный логин или пароль',
				captcha: needsCaptcha(ip),
			},
			401,
		)
	}

	if (!user) {
		// Работа та же, что и при реальной проверке: иначе по времени ответа
		// можно отличить «нет такой почты» от «неверный пароль».
		await burnPasswordCheck(password)
		return FAIL()
	}
	if (!user.passwordHash) {
		// Аккаунт создан через Twitch и пароля не имеет. Отвечаем так же, как на
		// неверный пароль: иначе можно перебором узнать, где зарегистрирована почта.
		await burnPasswordCheck(password)
		return FAIL()
	}

	const ok = await verifyPassword(user.passwordHash, password)
	if (!ok) return FAIL()

	failures.delete(ip)
	await touchUserLogin(user.id)

	const res = NextResponse.json({ ok: true, next })
	setSessionCookie(res, req, sessionForUser(user))
	return res
}
