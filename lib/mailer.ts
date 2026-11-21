import nodemailer, { type Transporter } from 'nodemailer'
import { renderEmail } from './emailTemplate'

// Отправка писем с кодами подтверждения.
//
// Два способа доставки, выбираются по окружению:
//
//   1. Resend HTTP API — самый простой путь: один ключ, ничего настраивать не надо.
//        RESEND_API_KEY=re_...
//        MAIL_FROM="Ovrly <no-reply@ваш-домен>"
//
//   2. SMTP (Яндекс 360, Mail.ru, Brevo, SendPulse, свой сервер):
//        SMTP_HOST=smtp.yandex.ru
//        SMTP_PORT=465           (465 = TLS сразу, 587 = STARTTLS)
//        SMTP_USER=no-reply@ваш-домен
//        SMTP_PASS=пароль-приложения
//        MAIL_FROM="Ovrly <no-reply@ваш-домен>"
//
// Если не настроено ничего:
//  - в production регистрация по почте возвращает 503 (ошибка конфигурации);
//  - в dev код печатается в консоль сервера и отдаётся в ответе API.
//
// Письма и коды не логируем: код одноразовый и живёт 10 минут.

type SendResult = { delivered: boolean; reason?: string; provider?: string }

let transporter: Transporter | null = null

function smtpConfigured(): boolean {
	return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function resendConfigured(): boolean {
	return Boolean(process.env.RESEND_API_KEY)
}

function getTransporter(): Transporter {
	if (!transporter) {
		const port = Number(process.env.SMTP_PORT || 587)
		transporter = nodemailer.createTransport({
			host: process.env.SMTP_HOST,
			port,
			secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true' || port === 465,
			auth: {
				user: process.env.SMTP_USER,
				pass: process.env.SMTP_PASS,
			},
			// не даём зависшему SMTP держать запрос минутами
			connectionTimeout: 10_000,
			greetingTimeout: 10_000,
			socketTimeout: 15_000,
		})
	}
	return transporter
}

const FROM = process.env.MAIL_FROM || process.env.SMTP_FROM || 'Ovrly <no-reply@ovrly.ru>'

export function mailAvailable(): boolean {
	return resendConfigured() || smtpConfigured()
}

// Бесплатный тариф Resend отдаёт письма только на собственный адрес аккаунта,
// пока не подтверждён домен. Это ловится ошибкой 403 от API — сообщаем понятно.
async function sendViaResend(
	to: string,
	subject: string,
	text: string,
	html: string,
): Promise<SendResult> {
	try {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
			signal: AbortSignal.timeout(15_000),
		})
		if (res.ok) return { delivered: true, provider: 'resend' }
		const detail = (await res.text().catch(() => '')).slice(0, 300)
		console.error('[mail:resend]', res.status, detail)
		return { delivered: false, reason: `resend_${res.status}`, provider: 'resend' }
	} catch (error) {
		console.error('[mail:resend] send failed:', (error as Error).message)
		return { delivered: false, reason: 'send_failed', provider: 'resend' }
	}
}

async function sendViaSmtp(
	to: string,
	subject: string,
	text: string,
	html: string,
): Promise<SendResult> {
	try {
		await getTransporter().sendMail({ from: FROM, to, subject, text, html })
		return { delivered: true, provider: 'smtp' }
	} catch (error) {
		console.error('[mail:smtp] send failed:', (error as Error).message)
		return { delivered: false, reason: 'send_failed', provider: 'smtp' }
	}
}

// Тестовое письмо: проверка настройки почты без регистрации аккаунта.
// Отправляется по тем же правилам, что и код подтверждения.
export async function sendTestEmail(to: string): Promise<SendResult> {
	const subject = 'Тест почты Ovrly'
	const { html, text } = renderEmail({
		preheader: 'Проверка настройки почты Ovrly',
		kicker: 'Проверка почты',
		heading: 'Почта настроена',
		intro:
			'Это тестовое письмо. Если вы его видите, то отправка работает и коды подтверждения будут доходить.',
		note: 'Ничего делать не нужно — письмо отправлено вручную из админ-панели.',
		reason: 'Письмо отправлено администратором Ovrly.',
	})

	if (resendConfigured()) return sendViaResend(to, subject, text, html)
	if (smtpConfigured()) return sendViaSmtp(to, subject, text, html)

	if (process.env.NODE_ENV === 'production') {
		return { delivered: false, reason: 'not_configured' }
	}
	console.log(`[mail:dev] тест для ${to} — почта не настроена`)
	return { delivered: false, reason: 'not_configured' }
}

export async function sendVerificationCode(
	email: string,
	code: string,
	purpose: 'register' | 'reset' = 'register',
): Promise<SendResult> {
	const subject =
		purpose === 'register'
			? `Код подтверждения Ovrly: ${code}`
			: `Восстановление доступа Ovrly: ${code}`

	const { html, text } = renderEmail({
		preheader:
			purpose === 'register'
				? `Код для регистрации в Ovrly: ${code}`
				: `Код для восстановления доступа Ovrly: ${code}`,
		kicker: purpose === 'register' ? 'Регистрация' : 'Восстановление доступа',
		heading:
			purpose === 'register'
				? 'Подтвердите почту'
				: 'Сброс пароля',
		intro:
			purpose === 'register'
				? 'Вы регистрируете аккаунт в Ovrly. Введите этот код в открытом окне — он подтвердит, что адрес ваш:'
				: 'Запрошен сброс пароля. Введите этот код в открытом окне:',
		code,
		note: 'Код действует 10 минут. Если вы ничего не запрашивали — просто проигнорируйте письмо, аккаунт останется в безопасности.',
		reason: 'Вы получили письмо, потому что этот адрес указан при регистрации на Ovrly.',
	})

	if (resendConfigured()) return sendViaResend(email, subject, text, html)
	if (smtpConfigured()) return sendViaSmtp(email, subject, text, html)

	if (process.env.NODE_ENV === 'production') {
		return { delivered: false, reason: 'not_configured' }
	}
	// dev: код виден в консоли сервера и в ответе API (только не в проде)
	console.log(`[mail:dev] ${email} → ${code}`)
	return { delivered: false, reason: 'not_configured' }
}
