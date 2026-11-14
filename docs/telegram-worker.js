// Cloudflare Worker-релей: проксирует api.telegram.org и t.me из зоны без
// блокировки. Настройка: создайте Worker, вставьте это, добавьте секрет
// OVRLY_SECRET (Settings → Variables), затем на сервере:
//   TELEGRAM_API_BASE=https://<worker>.workers.dev
//   TELEGRAM_WEB_BASE=https://<worker>.workers.dev
//   TELEGRAM_PROXY_SECRET=<тот же секрет>
export default {
	async fetch(req, env) {
		const secret = req.headers.get('x-ovrly-secret') || ''
		if (!env.OVRLY_SECRET || secret !== env.OVRLY_SECRET)
			return new Response('forbidden', { status: 403 })
		const url = new URL(req.url)
		const base = url.pathname.startsWith('/s/')
			? 'https://t.me'
			: 'https://api.telegram.org'
		const init = {
			method: req.method,
			headers: {
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
				'accept-language': 'ru,en;q=0.9',
			},
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			init.body = await req.text()
			init.headers['content-type'] = 'application/json'
		}
		const res = await fetch(base + url.pathname + url.search, init)
		return new Response(res.body, {
			status: res.status,
			headers: {
				'content-type': res.headers.get('content-type') || 'text/plain',
			},
		})
	},
}
