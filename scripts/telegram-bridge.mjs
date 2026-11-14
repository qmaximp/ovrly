// Мост Telegram → Ovrly для серверов, у которых заблокирован Telegram.
// Запускается на компьютере стримера: опрашивает getUpdates и пересылает
// сообщения группы на наш сайт. Telegram хранит необработанные апдейты сутки,
// поэтому короткие простои не теряют сообщения.
//
// Запуск: npm run telegram-bridge   (или node --env-file=.env.local scripts/telegram-bridge.mjs)

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim()
const SECRET = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
const TARGET =
	process.env.OVRLY_HOOK_URL || 'https://ovrly.ru/api/telegram/hook'
const STATE = new URL('./.telegram-bridge.json', import.meta.url)

if (!TOKEN || TOKEN.length < 20) {
	console.error('Нет TELEGRAM_BOT_TOKEN в .env.local')
	process.exit(1)
}
if (!SECRET) {
	console.error('Нет TELEGRAM_WEBHOOK_SECRET в .env.local')
	process.exit(1)
}

const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`

async function readOffset() {
	try {
		const { readFile } = await import('node:fs/promises')
		const raw = await readFile(STATE, 'utf8')
		return Number(JSON.parse(raw).offset) || 0
	} catch {
		return 0
	}
}

async function saveOffset(offset) {
	const { writeFile } = await import('node:fs/promises')
	await writeFile(STATE, JSON.stringify({ offset }), 'utf8')
}

async function forward(update) {
	const res = await fetch(TARGET, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-telegram-bot-api-secret-token': SECRET,
		},
		body: JSON.stringify(update),
		signal: AbortSignal.timeout(20000),
	})
	if (!res.ok) throw new Error(`сайт ответил ${res.status}`)
}

async function main() {
	// getUpdates не работает, пока включён вебхук — снимаем его на время работы
	// моста. Необработанные апдейты при этом не теряются.
	await fetch(api('deleteWebhook'), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ drop_pending_updates: false }),
	}).catch(() => {})

	let offset = await readOffset()
	console.log(`[bridge] старт, offset=${offset}, приёмник ${TARGET}`)

	for (;;) {
		try {
			const res = await fetch(
				api(`getUpdates?timeout=50&offset=${offset}&allowed_updates=${encodeURIComponent('["message","channel_post"]')}`),
				{ signal: AbortSignal.timeout(70000) },
			)
			const data = await res.json()
			if (!data.ok) throw new Error(data.description || 'Telegram вернул ошибку')
			for (const update of data.result || []) {
				try {
					await forward(update)
					offset = update.update_id + 1
					await saveOffset(offset)
					console.log(`[bridge] переслано update ${update.update_id}`)
				} catch (e) {
					console.error('[bridge] не удалось переслать:', e.message)
					await new Promise((r) => setTimeout(r, 5000))
				}
			}
		} catch (e) {
			console.error('[bridge] сеть:', e.message)
			await new Promise((r) => setTimeout(r, 5000))
		}
	}
}

main()
