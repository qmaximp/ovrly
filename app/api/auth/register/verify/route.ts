import { appendFile, mkdir } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { clientIp, json, rateLimit, readJson, tooMany } from '@/lib/api'
import { isEmail, normalizeEmail, sameOrigin, sessionForUser, setSessionCookie } from '@/lib/auth'
import { checkCode, clearCode } from '@/lib/emailCodes'
import { LEGAL_VERSION, consentCookieValue } from '@/lib/legal'
import { checkPassword, hashPassword, verifyPassword } from '@/lib/passwords'
import { createUser, findUserByEmail, touchUserLogin, updateUser, UserConflictError } from '@/lib/users'
import { getOrigin, safeNextPath } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Журнал согласий: фиксируем, что согласие дано до создания аккаунта или входа.
// Почта нужна, чтобы связать запись с аккаунтом; IP и UA — минимум для
// доказывания. Сбой записи не должен ломать регистрацию.
async function writeConsent(
	req: Request,
	ip: string,
	entry: { event: string; uid: string; email: string },
) {
	try {
		const dir = path.join(process.cwd(), 'data')
		await mkdir(dir, { recursive: true })
		await appendFile(
			path.join(dir, 'consents.jsonl'),
			JSON.stringify({
				...entry,
				at: new Date().toISOString(),
				method: 'email',
				version: LEGAL_VERSION,
				docs: ['terms', 'privacy', 'consent'],
				crossBorder: true,
				countries: ['US', 'AE'],
				ip,
				ua: (req.headers.get('user-agent') || '').slice(0, 300),
			}) + '\n',
			'utf8',
		)
	} catch {
		// журнал не должен ломать вход
	}
}

// После регистрации по email согласие уже дано — ставим тот же маркер, что и
// окно согласия, чтобы при следующем входе не спрашивать заново.
function setConsentCookie(res: NextResponse, req: Request, uid: string) {
	res.cookies.set('sc_consent', consentCookieValue(uid), {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 365,
		secure: getOrigin(req).startsWith('https:'),
	})
}

export async function POST(req: Request) {
	if (!sameOrigin(req)) return json({ error: 'Запрос отклонён' }, 403)

	const ip = clientIp(req)
	if (!rateLimit(`reg-verify:ip:${ip}`, 30, 60 * 60 * 1000)) return tooMany()

	let body: Record<string, unknown> | null = await readJson(req)
	if (!body) return json({ error: 'Некорректный запрос' }, 400)

	const email = normalizeEmail(body.email)
	const code = String(body.code ?? '').replace(/\s+/g, '')
	const password = String(body.password ?? '')
	const confirm = String(body.passwordConfirm ?? '')

	if (!isEmail(email)) return json({ error: 'Укажите корректный адрес почты' }, 400)
	if (!/^\d{6}$/.test(code)) return json({ error: 'Код состоит из 6 цифр' }, 400)
	if (body.consent !== true) {
		return json({ error: 'Нужно согласие на обработку персональных данных' }, 400)
	}
	if (password !== confirm) return json({ error: 'Пароли не совпадают' }, 400)

	const strength = checkPassword(password, email)
	if (!strength.ok) {
		return json({ error: strength.issues[0] ?? 'Слишком простой пароль', issues: strength.issues }, 400)
	}

	if (!rateLimit(`reg-verify:mail:${email}`, 15, 60 * 60 * 1000)) return tooMany()

	const status = await checkCode(email, code)
	if (status === 'missing') {
		return json({ error: 'Код не найден. Запросите новый.' }, 400)
	}
	if (status === 'expired') {
		await clearCode(email)
		return json({ error: 'Код истёк. Запросите новый.' }, 400)
	}
	if (status === 'too_many') {
		await clearCode(email)
		// 429 не даёт перебирать дальше даже при утечке кода
		return json({ error: 'Слишком много попыток. Запросите новый код.' }, 429)
	}
	if (status !== 'ok') return json({ error: 'Неверный код' }, 400)

	// Аккаунт с такой почтой уже есть — не создаём второй. Код из письма уже
	// подтвердил, что почта своя, поэтому: пароль совпал — просто входим;
	// не совпал — задаём новый (это равно сбросу пароля по коду).
	const existing = await findUserByEmail(email)
	if (existing) {
		await clearCode(email)
		const same = existing.passwordHash
			? await verifyPassword(existing.passwordHash, password)
			: false
		if (!same) {
			await updateUser(existing.id, { passwordHash: await hashPassword(password) })
		}
		await touchUserLogin(existing.id)
		await writeConsent(req, ip, {
			event: 'login',
			uid: existing.id,
			email,
		})
		const res = NextResponse.json({
			ok: true,
			loggedIn: true,
			passwordChanged: !same,
			next: safeNextPath(typeof body.next === 'string' ? body.next : null),
		})
		setSessionCookie(res, req, sessionForUser(existing))
		setConsentCookie(res, req, existing.id)
		return res
	}

	const displayName = email.split('@')[0].slice(0, 40) || 'Стример'
	let user
	try {
		user = await createUser({
			email,
			passwordHash: await hashPassword(password),
			displayName,
		})
	} catch (error) {
		if (error instanceof UserConflictError) {
			return json({ error: 'Аккаунт с этой почтой уже существует' }, 409)
		}
		console.error('[ovrly] не удалось создать пользователя', error)
		return json({ error: 'Не удалось создать аккаунт. Попробуйте позже.' }, 500)
	}

	await clearCode(email)
	// Фиксируем вход: регистрация сразу авторизует, иначе в админке аккаунт
	// навсегда остаётся «ещё не входил».
	await touchUserLogin(user.id)

	// Журнал согласий: фиксируем, что согласие дано до создания аккаунта.
	await writeConsent(req, ip, {
		event: 'register',
		uid: user.id,
		email,
	})

	const res = NextResponse.json({
		ok: true,
		next: safeNextPath(typeof body.next === 'string' ? body.next : null),
	})
	setSessionCookie(res, req, sessionForUser(user))
	setConsentCookie(res, req, user.id)
	return res
}
