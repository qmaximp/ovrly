import crypto from 'crypto'
import { clientIp, json, rateLimit, readJson, tooMany } from '@/lib/api'
import { isEmail, normalizeEmail, sameOrigin } from '@/lib/auth'
import { verifyCaptcha } from '@/lib/captcha'
import { clearCode, putCode, recentSend, resetKey } from '@/lib/emailCodes'
import { sendVerificationCode } from '@/lib/mailer'
import { findUserByEmail } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Шаг 1 восстановления: письмо с кодом.
//
// Ответ всегда одинаковый — и для зарегистрированной почты, и для чужой.
// Иначе формой можно было бы проверять, где есть аккаунт. Письмо при этом
// уходит только владельцу реального аккаунта: иначе сервис превратился бы
// в бесплатную рассылку по любым адресам.
export async function POST(req: Request) {
	if (!sameOrigin(req)) return json({ error: 'Запрос отклонён' }, 403)

	const ip = clientIp(req)
	if (!rateLimit(`reset:ip:${ip}`, 6, 60 * 60 * 1000)) return tooMany()

	const body = await readJson(req)
	if (!body) return json({ error: 'Некорректный запрос' }, 400)

	const email = normalizeEmail(body.email)
	if (!isEmail(email)) return json({ error: 'Укажите почту' }, 400)

	if (!verifyCaptcha(String(body.captchaToken ?? ''), String(body.captchaAnswer ?? ''))) {
		return json({ error: 'Неверный код с картинки', captcha: true }, 400)
	}

	const user = await findUserByEmail(email)
	const canReset = Boolean(user?.passwordHash)

	if (canReset) {
		if (!rateLimit(`reset:mail:${email}`, 3, 60 * 60 * 1000)) return tooMany()

		const key = resetKey(email)
		if (!(await recentSend(key))) {
			const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
			await putCode(key, code)

			const delivery = await sendVerificationCode(email, code, 'reset')
			if (!delivery.delivered) {
				await clearCode(key)
				if (delivery.reason === 'not_configured') {
					return json(
						{ error: 'Почта на сервере не настроена. Напишите в поддержку.' },
						503,
					)
				}
				return json({ error: 'Не удалось отправить письмо. Попробуйте позже.' }, 502)
			}
		}
	} else {
		// Выравниваем время ответа, чтобы отсутствие аккаунта не читалось по задержке.
		await new Promise(r => setTimeout(r, 350))
	}

	return json({ ok: true })
}
