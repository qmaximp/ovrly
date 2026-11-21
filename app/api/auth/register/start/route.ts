import crypto from 'crypto'
import { json, clientIp, rateLimit, readJson, tooMany } from '@/lib/api'
import { isEmail, normalizeEmail, sameOrigin } from '@/lib/auth'
import { verifyCaptcha } from '@/lib/captcha'
import { clearCode, putCode, recentSend } from '@/lib/emailCodes'
import { sendVerificationCode } from '@/lib/mailer'
import { findUserByEmail } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEV = process.env.NODE_ENV !== 'production'

export async function POST(req: Request) {
	if (!sameOrigin(req)) return json({ error: 'Запрос отклонён' }, 403)

	const ip = clientIp(req)
	if (!rateLimit(`reg-start:ip:${ip}`, 10, 60 * 60 * 1000)) return tooMany()
	if (!rateLimit(`reg-start:ip-min:${ip}`, 3, 60 * 1000)) return tooMany()

	let body: Record<string, unknown> | null = await readJson(req)
	if (!body) return json({ error: 'Некорректный запрос' }, 400)

	const email = normalizeEmail(body.email)
	if (!isEmail(email)) return json({ error: 'Укажите корректный адрес почты' }, 400)
	if (body.consent !== true) {
		return json({ error: 'Нужно согласие на обработку персональных данных' }, 400)
	}

	if (!verifyCaptcha(String(body.captchaToken ?? ''), String(body.captchaAnswer ?? ''))) {
		return json({ error: 'Неверный код с картинки', captcha: true }, 400)
	}

	if (!rateLimit(`reg-start:mail:${email}`, 4, 60 * 60 * 1000)) return tooMany()
	if (await recentSend(email)) {
		return json({ error: 'Код уже отправлен. Подождите минуту перед повторной отправкой.' }, 429)
	}

	// Аккаунт с такой почтой уже есть — не блокируем, а продолжаем: код
	// подтвердит, что почта своя, и мы просто пустим человека в аккаунт
	// (пароль сверим на втором шаге, при расхождении обновим на новый).
	const existing = await findUserByEmail(email)

	// 6 цифр: 900 000 вариантов, а попытки ограничены на сервере (5 на код).
	const code = String(crypto.randomInt(100_000, 1_000_000))
	await putCode(email, code)

	const delivery = await sendVerificationCode(email, code)
	if (!delivery.delivered) {
		if (delivery.reason === 'not_configured') {
			if (DEV) {
				// Локальная разработка без SMTP: код печатается в консоль сервера
				// и возвращается в ответе, чтобы можно было пройти регистрацию.
				console.log(`[ovrly] код подтверждения для ${email}: ${code}`)
				return json({
					ok: true,
					devCode: code,
					email,
					delivery: 'console',
					existing: Boolean(existing),
				})
			}
			await clearCode(email)
			return json(
				{ error: 'Отправка писем не настроена. Напишите в поддержку.' },
				503,
			)
		}
		await clearCode(email)
		// 403 от Resend — почти всегда неподтверждённый домен: на бесплатном
		// тарифе письма уходят только на адрес владельца аккаунта.
		if (delivery.reason === 'resend_403') {
			return json(
				{
					error:
						'Почтовый сервис отклонил отправку: подтвердите домен в Resend или укажите MAIL_FROM на адрес аккаунта.',
				},
				503,
			)
		}
		return json({ error: 'Не удалось отправить письмо. Попробуйте позже.' }, 502)
	}

	return json({ ok: true, email, existing: Boolean(existing) })
}
