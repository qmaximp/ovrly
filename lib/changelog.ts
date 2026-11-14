import * as storage from './storage'
import {
	isBotConfigured,
	syncTelegramChangelog,
	SOURCE_CHAT,
	type BotEntry,
} from './telegramBot'

export type ChangelogEntry = {
	id?: string
	text: string
	date: string
	url: string
	photo?: string
}

export type ChangelogData = {
	channel: string
	title: string
	url: string
	updatedAt: number
	entries: ChangelogEntry[]
	error?: string
}

const ENTRIES = 'changelog_entries'

// Старые записи не копим бесконечно: в кабинете всё равно нужны последние.
const MAX_ENTRIES = 300

type ManualEntry = ChangelogEntry & { id: string }

async function getManualEntries(): Promise<ManualEntry[]> {
	const raw = await storage.getSetting<ManualEntry[] | null>(ENTRIES)
	if (!Array.isArray(raw)) return []
	return raw
		.filter(
			e =>
				e &&
				typeof e.id === 'string' &&
				(typeof e.text === 'string' || typeof e.url === 'string'),
		)
		.map(e => ({
			id: e.id,
			text: String(e.text || '').slice(0, 4000),
			url: String(e.url || '').slice(0, 500),
			date: String(e.date || new Date().toISOString()),
			photo: e.photo ? String(e.photo).slice(0, 500) : undefined,
		}))
		.slice(-MAX_ENTRIES)
}

export async function addManualEntry(input: {
	text?: string
	url?: string
	date?: string
}): Promise<ManualEntry> {
	const text = String(input.text || '').trim().slice(0, 4000)
	const url = String(input.url || '').trim().slice(0, 500)
	if (!text && !url) throw new Error('Добавьте текст или ссылку на пост')
	const all = await getManualEntries()
	const entry: ManualEntry = {
		id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		text,
		url,
		date: input.date || new Date().toISOString(),
	}
	all.push(entry)
	await storage.setSetting(ENTRIES, all)
	return entry
}

export async function removeManualEntry(id: string): Promise<void> {
	const all = await getManualEntries()
	await storage.setSetting(
		ENTRIES,
		all.filter(e => e.id !== id),
	)
}

// Записи из Bot API: id вида tg<chat_id>_<message_id> — повторный импорт
// не создаёт дублей, а правки в группе не перезаписывают уже сохранённое.
export async function importBotEntries(entries: BotEntry[]): Promise<number> {
	if (!entries.length) return 0
	const all = await getManualEntries()
	const seen = new Set(all.map(e => e.id))
	let added = 0
	for (const entry of entries) {
		if (!entry?.id || seen.has(entry.id)) continue
		seen.add(entry.id)
		all.push({
			id: entry.id,
			text: String(entry.text || '').slice(0, 4000),
			url: String(entry.url || '').slice(0, 500),
			date: String(entry.date || new Date().toISOString()),
			photo: entry.photo ? String(entry.photo).slice(0, 500) : undefined,
		})
		added++
	}
	if (!added) return 0
	all.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))
	await storage.setSetting(ENTRIES, all.slice(-MAX_ENTRIES))
	return added
}

// Список обновлений собирается только из группы @ovrly_control:
// новые сообщения приносит бот (lib/telegramBot.ts), старую историю и правки
// админ добавляет вручную. Никакие другие каналы и чаты не подмешиваются.
export async function loadChangelog(
	opts: { sync?: boolean } = {},
): Promise<ChangelogData> {
	if (opts.sync !== false && isBotConfigured()) {
		const result = await syncTelegramChangelog()
		if (result.entries.length) await importBotEntries(result.entries)
	}
	const manual = await getManualEntries()
	return {
		channel: SOURCE_CHAT,
		title: 'Ovrly',
		url: `https://t.me/${SOURCE_CHAT}`,
		updatedAt: Date.now(),
		entries: manual.slice().reverse().map(e => ({ ...e })),
	}
}
