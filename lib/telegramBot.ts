import * as storage from './storage'

// Импорт обновлений из приватной группы Telegram через Bot API.
// Публичная веб-версия (t.me/s) посты групп не отдаёт, поэтому бот должен быть
// администратором группы: тогда он получает все сообщения начиная с момента,
// когда его добавили. Старую историю Bot API не отдаёт — её переносит
// scripts/import-telegram-export.mjs из экспорта Telegram Desktop.
export type BotStatus = {
	configured: boolean
	chat: string
	offset: number
	lastSyncAt: number
	lastError: string
	mode: 'webhook' | 'polling'
	webhook: boolean
}

export type BotEntry = {
	id: string
	text: string
	date: string
	url: string
	photo?: string
}

export type BotSyncResult = {
	entries: BotEntry[]
	error?: string
	// true — сообщения приходят вебхуком, опрос getUpdates не выполняется
	webhook?: boolean
}

const SOURCE_ID = 'changelog_tg_source_id'
const OFFSET = 'changelog_tg_offset'
const SYNC_AT = 'changelog_tg_sync_at'
const LAST_ERROR = 'changelog_tg_error'

// Единственный разрешённый источник обновлений. Менять через админку нельзя:
// всё, что приходит из других чатов, отбрасывается.
export const SOURCE_CHAT = 'ovrly_control'
export const SOURCE_URL = `https://t.me/${SOURCE_CHAT}/1`

// getUpdates дёргается при загрузке списка, поэтому не чаще раза в минуту.
const SYNC_INTERVAL = 60 * 1000

// Хостинг в РФ часто не пускает наружу на api.telegram.org — тогда работает
// режим вебхука: Telegram сам присылает апдейты, исходящие запросы не нужны.
const API = (
	process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'
).replace(/\/+$/, '')

export function webhookSecret(): string {
	return (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
}

// Вебхук включён, если задан секрет: иначе остаётся опрос getUpdates.
export function isWebhookMode(): boolean {
	return webhookSecret().length > 10
}

type TgChat = { id: number; username?: string; type?: string }
type TgMessage = {
	message_id: number
	date: number
	text?: string
	caption?: string
	chat: TgChat
	photo?: { file_id: string; width?: number; height?: number }[]
	// форумы: General = тема 1; остальные темы не берём
	is_topic_message?: boolean
	message_thread_id?: number
	media_group_id?: string
}
type TgUpdate = {
	update_id: number
	message?: TgMessage
	edited_message?: TgMessage
	channel_post?: TgMessage
}

export function botToken(): string {
	return (process.env.TELEGRAM_BOT_TOKEN || '').trim()
}

export function isBotConfigured(): boolean {
	return botToken().length > 20
}

async function callApi<T>(
	method: string,
	params: Record<string, unknown> = {},
): Promise<T> {
	const token = botToken()
	if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN')
	let res: Response
	try {
		res = await fetch(`${API}/bot${token}/${method}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(process.env.TELEGRAM_PROXY_SECRET
					? { 'x-ovrly-secret': process.env.TELEGRAM_PROXY_SECRET }
					: {}),
			},
			body: JSON.stringify(params),
			cache: 'no-store',
			signal: AbortSignal.timeout(10000),
		})
	} catch (e) {
		throw new Error(`Telegram недоступен: ${(e as Error)?.message || 'сеть'}`)
	}
	const data = (await res.json().catch(() => null)) as {
		ok: boolean
		result?: T
		description?: string
	} | null
	if (!data) throw new Error(`Telegram: пустой ответ (${res.status})`)
	if (!data.ok) throw new Error(`Telegram: ${data.description || res.status}`)
	return data.result as T
}

export async function getBotStatus(): Promise<BotStatus> {
	const [offset, lastSyncAt, lastError] = await Promise.all([
		storage.getSetting<number>(OFFSET),
		storage.getSetting<number>(SYNC_AT),
		storage.getSetting<string>(LAST_ERROR),
	])
	return {
		configured: isBotConfigured(),
		chat: SOURCE_CHAT,
		offset: Number(offset) || 0,
		lastSyncAt: Number(lastSyncAt) || 0,
		lastError: String(lastError || ''),
		mode: isWebhookMode() ? 'webhook' : 'polling',
		webhook: isWebhookMode(),
	}
}

// Источник — только группа @ovrly_control. Личные чаты, каналы и любые другие
// группы отбрасываем, даже если бота туда добавили. Числовой id запоминаем при
// первом совпадении: если у группы когда-нибудь сменится username, импорт не
// сломается и по-прежнему будет брать только эту группу.
function isSourceChat(chat: TgChat, knownId: number): boolean {
	const type = chat.type || ''
	if (type && type !== 'group' && type !== 'supergroup') return false
	if (knownId && chat.id === knownId) return true
	return (chat.username || '').toLowerCase() === SOURCE_CHAT
}

function toEntry(msg: TgMessage): BotEntry | null {
	// В группе с темами берём только General (тема 1) — ровно то, что видно по
	// ссылке t.me/ovrly_control/1; сообщения из боковых тем не импортируем.
	if (
		msg.is_topic_message &&
		typeof msg.message_thread_id === 'number' &&
		msg.message_thread_id !== 1
	)
		return null
	const text = (msg.text || msg.caption || '').trim()
	const photos = Array.isArray(msg.photo) ? msg.photo : []
	const best = photos
		.slice()
		.sort(
			(a, b) =>
				(b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0),
		)[0]
	if (!text && !best) return null
	return {
		id: `tg${msg.chat.id}_${msg.message_id}`,
		text,
		date: new Date(msg.date * 1000).toISOString(),
		url: `https://t.me/${SOURCE_CHAT}/${msg.message_id}`,
		// Отдаём фото через свой прокси: токен бота не должен попасть в HTML.
		photo: best
			? `/api/changelog/photo/${encodeURIComponent(best.file_id)}`
			: undefined,
	}
}

let inflight: Promise<BotSyncResult> | null = null

// Без force синхронизация выполняется не чаще раза в минуту — список обновлений
// открывают все пользователи кабинета, лишние запросы к Telegram не нужны.
export async function syncTelegramChangelog(
	opts: { force?: boolean } = {},
): Promise<BotSyncResult> {
	if (!isBotConfigured()) return { entries: [] }
	// В режиме вебхука новые сообщения приходят сами: опрашивать Telegram
	// нельзя (да и не нужно) — на этом хостинге наружу он недоступен.
	if (isWebhookMode()) {
		return { entries: [], webhook: true }
	}
	if (!opts.force) {
		const last = Number(await storage.getSetting<number>(SYNC_AT)) || 0
		if (Date.now() - last < SYNC_INTERVAL) return { entries: [] }
	}
	if (inflight) return inflight
	inflight = runSync().finally(() => {
		inflight = null
	})
	return inflight
}

async function runSync(): Promise<BotSyncResult> {
	let knownId = Number(await storage.getSetting<number>(SOURCE_ID)) || 0
	let offset = Number(await storage.getSetting<number>(OFFSET)) || 0
	try {
		const updates = await callApi<TgUpdate[]>('getUpdates', {
			offset,
			limit: 100,
			timeout: 0,
			allowed_updates: ['message', 'channel_post'],
		})
		const entries: BotEntry[] = []
		for (const update of updates) {
			offset = Math.max(offset, update.update_id + 1)
			const msg = update.message || update.channel_post
			if (!msg || !isSourceChat(msg.chat, knownId)) continue
			if (msg.chat.id !== knownId) {
				knownId = msg.chat.id
				await storage.setSetting(SOURCE_ID, knownId)
			}
			const entry = toEntry(msg)
			if (entry) entries.push(entry)
		}
		await storage.setSetting(OFFSET, offset)
		await storage.setSetting(SYNC_AT, Date.now())
		await storage.setSetting(LAST_ERROR, '')
		return { entries }
	} catch (e) {
		const message = (e as Error)?.message || 'Не удалось прочитать Telegram'
		await storage.setSetting(LAST_ERROR, message)
		return { entries: [], error: message }
	}
}

// Разбор одного апдейта Telegram для вебхука: фильтр источника, тема, текст.
export async function entryFromUpdate(input: unknown): Promise<BotEntry | null> {
	const update = input as TgUpdate | null
	if (!update || typeof update !== 'object') return null
	const msg = update.message || update.edited_message || update.channel_post
	if (!msg || typeof msg.message_id !== 'number') return null
	const knownId = Number(await storage.getSetting<number>(SOURCE_ID)) || 0
	if (!isSourceChat(msg.chat, knownId)) return null
	// запомним числовой id: если username сменят, импорт не сломается
	if (msg.chat.id !== knownId) await storage.setSetting(SOURCE_ID, msg.chat.id)
	const entry = toEntry(msg)
	if (entry) {
		await storage.setSetting(SYNC_AT, Date.now())
		await storage.setSetting(LAST_ERROR, '')
	}
	return entry
}

// Прокси изображений: getFile отдаёт путь, файл тянем сервером.
export async function fetchTelegramPhoto(
	fileId: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
	const file = await callApi<{ file_path?: string }>('getFile', {
		file_id: fileId,
	})
	if (!file?.file_path) return null
	const res = await fetch(
		`${API}/file/bot${botToken()}/${file.file_path}`,
		{ cache: 'no-store', signal: AbortSignal.timeout(15000) },
	)
	if (!res.ok || !res.body) return null
	const ext = file.file_path.split('.').pop()?.toLowerCase() || ''
	const contentType =
		res.headers.get('content-type') ||
		(ext === 'png' ? 'image/png' : 'image/jpeg')
	return { body: res.body, contentType }
}
