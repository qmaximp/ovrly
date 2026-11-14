import { TG_MEDIA_HOST } from '@/lib/telegramFeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Картинки Telegram через наш домен: у части провайдеров telesco.pe режется.
export async function GET(req: Request) {
	const u = new URL(req.url).searchParams.get('u') || ''
	let host = ''
	try {
		host = new URL(u).hostname
	} catch {
		return new Response('Bad request', { status: 400 })
	}
	if (!TG_MEDIA_HOST.test(host) || !/^https?:$/.test(new URL(u).protocol))
		return new Response('Forbidden', { status: 403 })

	const base = (process.env.TELEGRAM_WEB_BASE || '').replace(/\/+$/, '')
	const relay = base && process.env.TELEGRAM_PROXY_SECRET
	const targets = [
		...(relay ? [`${base}/raw?u=${encodeURIComponent(u)}`] : []),
		u,
	]
	for (const target of targets) {
		try {
			const res = await fetch(target, {
			headers: {
				...(relay
					? { 'x-ovrly-secret': process.env.TELEGRAM_PROXY_SECRET! }
					: {}),
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
			},
			signal: AbortSignal.timeout(20000),
			cache: 'no-store',
		})
			if (!res.ok) continue
			return new Response(res.body, {
				headers: {
					'content-type': res.headers.get('content-type') || 'image/jpeg',
					'cache-control':
						'public, max-age=86400, stale-while-revalidate=604800',
				},
			})
		} catch {
			// пробуем следующий способ: релей мог не уметь /raw
		}
	}
	return new Response('Bad gateway', { status: 502 })
}
