import { adminFrom, clientIp, json, rateLimit, readJson, tooMany } from '@/lib/api'
import { mailAvailable, sendTestEmail } from '@/lib/mailer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Проверка почты из админки: отправляет тестовое письмо и возвращает результат.
// Нужна, чтобы не гадать «доходит или нет», а увидеть ответ провайдера.

export async function GET() {
	const available = mailAvailable()
	return json({
		available,
		provider: process.env.RESEND_API_KEY
			? 'resend'
			: process.env.SMTP_HOST
				? 'smtp'
				: null,
	})
}

export async function POST(req: Request) {
	const admin = adminFrom(req)
	if (!admin) return json({ error: 'forbidden' }, 403)
	if (!rateLimit(`mail-test:${admin}:${clientIp(req)}`, 10, 60_000)) return tooMany()

	const body = await readJson(req)
	const to = typeof body?.to === 'string' ? body.to.trim() : ''
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) || to.length > 254) {
		return json({ error: 'Укажите корректный адрес' }, 400)
	}
	if (!mailAvailable()) {
		return json(
			{ error: 'Почта не настроена: нет RESEND_API_KEY и SMTP_*' },
			503,
		)
	}

	const result = await sendTestEmail(to)
	if (!result.delivered) {
		return json(
			{ error: 'Провайдер не принял письмо', reason: result.reason || 'unknown' },
			502,
		)
	}
	return json({ ok: true, provider: result.provider, to })
}
