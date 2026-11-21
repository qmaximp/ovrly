import { NextResponse } from 'next/server'
import { clientIp, json, rateLimit, readJson, tooMany } from '@/lib/api'
import { isEmail, normalizeEmail, sameOrigin, sessionForUser, setSessionCookie } from '@/lib/auth'
import { checkCode, clearCode, resetKey } from '@/lib/emailCodes'
import { checkPassword, hashPassword } from '@/lib/passwords'
import { safeNextPath } from '@/lib/session'
import { findUserByEmail, touchUserLogin, updateUser } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Шаг 2: код из письма + новый пароль. После успеха сразу пускаем в кабинет.
export async function POST(req: Request) {
	if (!sameOrigin(req)) return json({ error: 'Запрос отклонён' }, 403)

	const ip = clientIp(req)
	if (!rateLimit(`reset-verify:ip:${ip}`, 12, 60 * 60 * 1000)) return tooMany()

	const body = await readJson(req)
	if (!body) return json({ error: 'Некорректный запрос' }, 400)

	const email = normalizeEmail(body.email)
	const code = String(body.code ?? '').trim()
	const password = String(body.password ?? '')

	if (!isEmail(email)) return json({ error: 'Укажите почту' }, 400)
	if (!/^\d{6}$/.test(code)) return json({ error: 'Код — шесть цифр из письма' }, 400)

	const strength = checkPassword(password, email)
	if (!strength.ok) {
		return json({ error: strength.issues[0] || 'Пароль слишком слабый' }, 400)
	}

	const key = resetKey(email)
	const verdict = await checkCode(key, code)
	if (verdict === 'missing') return json({ error: 'Код устарел. Запросите новый.' }, 400)
	if (verdict === 'too_many') return json({ error: 'Слишком много попыток. Запросите новый код.' }, 429)
	if (verdict !== 'ok') return json({ error: 'Неверный код' }, 400)

	const user = await findUserByEmail(email)
	if (!user) return json({ error: 'Не удалось изменить пароль' }, 400)

	await updateUser(user.id, { passwordHash: await hashPassword(password) })
	await touchUserLogin(user.id)
	await clearCode(key)

	const res = NextResponse.json({
		ok: true,
		next: safeNextPath(typeof body.next === 'string' ? body.next : null),
	})
	setSessionCookie(res, req, sessionForUser(user))
	return res
}
