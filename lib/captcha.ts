import crypto from 'crypto'
import { SECRET } from './session'

// Лёгкая капча без внешних сервисов (не нужны ключи и лишние запросы).
// Сервер отдаёт SVG с искажённым кодом и подписанный токен, в котором лежит
// только хэш ответа и срок жизни: сам код на клиент не попадает.
//
// Это барьер против простых ботов и скриптов, а не против целевого обхода.
// Основную защиту дают лимиты и подтверждение почты кодом.

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const TTL_MS = 10 * 60 * 1000
const WIDTH = 180
const HEIGHT = 64

// Одноразовость: без этого один решённый токен можно переиспользовать.
const used = new Map<string, number>()

function sign(payload: string): string {
	return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

function answerHash(answer: string): string {
	return crypto
		.createHash('sha256')
		.update(answer.trim().toUpperCase())
		.digest('hex')
}

function escapeXml(value: string): string {
	return value.replace(/[<>&"']/g, ch => `&#${ch.charCodeAt(0)};`)
}

function randomBetween(min: number, max: number): number {
	return min + Math.random() * (max - min)
}

export function createCaptcha(): { token: string; svg: string; expiresIn: number } {
	const code = Array.from(
		{ length: 5 },
		() => CHARS[crypto.randomInt(0, CHARS.length)],
	).join('')
	const expires = Date.now() + TTL_MS
	const payload = Buffer.from(
		JSON.stringify({ h: answerHash(code), e: expires, n: crypto.randomUUID() }),
	).toString('base64url')
	const token = `${payload}.${sign(payload)}`

	const parts: string[] = []
	parts.push(
		`<rect width="${WIDTH}" height="${HEIGHT}" rx="10" fill="#0c1a24"/>`,
	)
	// шумовые линии
	for (let i = 0; i < 5; i++) {
		const y1 = randomBetween(6, HEIGHT - 6)
		const y2 = randomBetween(6, HEIGHT - 6)
		parts.push(
			`<path d="M0 ${y1.toFixed(1)} Q ${(WIDTH / 2).toFixed(1)} ${randomBetween(0, HEIGHT).toFixed(1)} ${WIDTH} ${y2.toFixed(1)}" stroke="rgba(126,242,208,0.18)" stroke-width="1.4" fill="none"/>`,
		)
	}
	// шумовые точки
	for (let i = 0; i < 22; i++) {
		parts.push(
			`<circle cx="${randomBetween(2, WIDTH - 2).toFixed(1)}" cy="${randomBetween(2, HEIGHT - 2).toFixed(1)}" r="1" fill="rgba(160,190,210,0.35)"/>`,
		)
	}
	const step = WIDTH / (code.length + 1)
	// Лёгкое искажение: визуально буквы «плывут», но остаются читаемыми.
	parts.push(
		`<defs><filter id="warp" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.06" numOctaves="2" seed="${crypto.randomInt(1, 9999)}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`,
	)
	parts.push('<g filter="url(#warp)">')
	for (let i = 0; i < code.length; i++) {
		const x = step * (i + 1) + randomBetween(-3, 3)
		const y = HEIGHT / 2 + randomBetween(-4, 4)
		const angle = randomBetween(-18, 18)
		parts.push(
			`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="ui-monospace, Consolas, monospace" font-size="30" font-weight="700" fill="#7ef2d0" text-anchor="middle" dominant-baseline="middle" transform="rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${escapeXml(code[i])}</text>`,
		)
	}
	// Ловушки для простых скрейперов, которые берут все <text> подряд.
	for (let i = 0; i < 4; i++) {
		const fake = CHARS[crypto.randomInt(0, CHARS.length)]
		parts.push(
			`<text x="${randomBetween(6, WIDTH - 6).toFixed(1)}" y="${randomBetween(10, HEIGHT - 10).toFixed(1)}" font-family="monospace" font-size="26" fill="#7ef2d0" opacity="0" aria-hidden="true">${fake}</text>`,
		)
	}
	parts.push('</g>')

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Проверка на робота">${parts.join('')}</svg>`
	return { token, svg, expiresIn: Math.floor(TTL_MS / 1000) }
}

export function verifyCaptcha(token: string, answer: string): boolean {
	if (!token || !answer) return false
	const now = Date.now()
	for (const [key, exp] of used) if (exp < now) used.delete(key)
	if (used.has(token)) return false

	const [payload, sig] = token.split('.')
	if (!payload || !sig) return false
	const expected = sign(payload)
	const a = Buffer.from(sig)
	const b = Buffer.from(expected)
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false

	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
			h?: string
			e?: number
		}
		if (!data.h || typeof data.e !== 'number' || data.e < now) return false
		const given = Buffer.from(answerHash(answer))
		const want = Buffer.from(data.h)
		if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
			return false
		}
		// токен сгорает при первом успешном использовании
		used.set(token, data.e)
		return true
	} catch {
		return false
	}
}
