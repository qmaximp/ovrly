import { isAdminLogin } from './admin'
import { verifySession, type TwitchSession } from './session'

// Общие помощники для API-роутов: единый JSON-ответ, разбор сессионной cookie
// и простой in-memory лимитер. Раньше каждый роут держал свою копию — из-за
// этого легко было забыть no-store или по-разному декодировать cookie.

export const json = (
	data: unknown,
	status = 200,
	headers: Record<string, string> = {},
) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			// ответы зависят от пользователя — не кэшируем ни в браузере, ни на прокси
			'Cache-Control': 'no-store',
			...headers,
		},
	})

// Значение cookie по имени. decodeURIComponent может бросить на битом значении,
// поэтому падаем на сырую строку, а не отдаём 500.
export function cookieValue(
	header: string | null | undefined,
	name = 'sc_session',
): string | null {
	const raw = header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1]
	if (!raw) return null
	try {
		return decodeURIComponent(raw)
	} catch {
		return raw
	}
}

export function sessionFrom(req: Request): TwitchSession | null {
	return verifySession(cookieValue(req.headers.get('cookie')) ?? undefined)
}

export function adminFrom(req: Request): TwitchSession | null {
	const session = sessionFrom(req)
	return session && isAdminLogin(session.login) ? session : null
}

export function clientIp(req: Request): string {
	const forwarded = (req.headers.get('x-forwarded-for') || '')
		.split(',')[0]
		.trim()
	return forwarded || req.headers.get('x-real-ip') || 'unknown'
}

// Простой лимитер «сколько раз за окно». Хранит только метки времени в памяти
// процесса: для защиты от спама публичных эндпоинтов этого достаточно, а при
// нескольких инстансах лимит будет считаться по каждому отдельно.
const buckets = new Map<string, number[]>()

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now()
	const recent = (buckets.get(key) || []).filter(t => now - t < windowMs)
	if (recent.length >= limit) {
		buckets.set(key, recent)
		return false
	}
	recent.push(now)
	buckets.set(key, recent)
	// защита от роста карты: чистим протухшие записи
	if (buckets.size > 5000) {
		for (const [k, times] of buckets) {
			if (!times.length || now - times[times.length - 1] > windowMs) buckets.delete(k)
		}
	}
	return true
}

export const tooMany = () =>
	json({ error: 'too many requests' }, 429, { 'Retry-After': '60' })
