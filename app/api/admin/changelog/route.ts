import { adminFrom, json } from '@/lib/api'
import {
	addManualEntry,
	importBotEntries,
	loadChangelog,
	removeManualEntry,
} from '@/lib/changelog'
import {
	getBotStatus,
	isBotConfigured,
	syncTelegramChangelog,
} from '@/lib/telegramBot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Список + состояние бота: клиенту нужны оба, чтобы показать блок группы.
async function payload() {
	const data = await loadChangelog({ sync: false })
	return { ...data, bot: await getBotStatus() }
}

function adminLogin(req: Request) {
	return adminFrom(req)?.login ?? null
}

export async function GET(req: Request) {
	if (!adminLogin(req)) return json({ error: 'forbidden' }, 403)
	return json(await payload())
}

export async function POST(req: Request) {
	if (!adminLogin(req)) return json({ error: 'forbidden' }, 403)
	let body: {
		add?: { text?: string; url?: string; date?: string }
		remove?: string
		tgSync?: boolean
	} = {}
	try {
		body = await req.json()
	} catch {
		return json({ error: 'bad json' }, 400)
	}
	if (body.remove) {
		await removeManualEntry(String(body.remove))
		return json(await payload())
	}
	if (body.add) {
		try {
			await addManualEntry(body.add)
		} catch (e) {
			return json(
				{ error: (e as Error)?.message || 'Не удалось добавить запись' },
				400,
			)
		}
		return json(await payload())
	}
	if (body.tgSync) {
		if (!isBotConfigured())
			return json(
				{ error: 'Не задан TELEGRAM_BOT_TOKEN в переменных окружения' },
				400,
			)
		const result = await syncTelegramChangelog({ force: true })
		if (result.entries.length) await importBotEntries(result.entries)
		return json({
			...await payload(),
			// в режиме вебхука опрос недоступен — клиент покажет подсказку
			syncNote: result.webhook
				? 'Обновления приходят вебхуком: новые сообщения появляются сами.'
				: result.error || '',
		})
	}
	// Источник обновлений зафиксирован — группа @ovrly_control. Других
	// источников у «Списка обновлений» нет.
	return json(await payload())
}
