import * as storage from './storage'
import { normalizeTelegramChannel } from './telegram'
import { loadTelegramChannel, type TelegramPost } from './telegramFeed'

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

const SETTING = 'changelog_channel'
const ENTRIES = 'changelog_entries'

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
		.slice(-100)
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

export async function getChangelogChannel(): Promise<string> {
	const raw = await storage.getSetting<string | null>(SETTING)
	return normalizeTelegramChannel(raw || '')
}

export async function setChangelogChannel(channel: string): Promise<string> {
	const normalized = normalizeTelegramChannel(channel)
	await storage.setSetting(SETTING, normalized)
	return normalized
}

function toEntry(post: TelegramPost): ChangelogEntry {
	return {
		text: post.text.trim(),
		date: post.date,
		url: post.url,
		// В списке — только изображения: кружок/видео в <img> не покажешь.
		photo: post.photo || post.media?.find(m => m.kind === 'photo')?.url || '',
	}
}

// Кабинет показывает последние посты выбранного канала как список обновлений.
// Публичные группы Telegram не отдают посты через t.me/s, поэтому админ может
// добавить записи вручную — они показываются вместе с постами канала.
export async function loadChangelog(): Promise<ChangelogData> {
	const channel = await getChangelogChannel()
	const manual = await getManualEntries()
	const manualEntries = manual
		.slice()
		.reverse()
		.map(e => ({ ...e }))
	if (!channel) {
		return {
			channel: '',
			title: manualEntries.length ? 'Ovrly' : '',
			url: '',
			updatedAt: Date.now(),
			entries: manualEntries,
		}
	}
	try {
		const feed = await loadTelegramChannel(channel)
		const entries = [
			...feed.posts
				.slice()
				.reverse()
				.map(toEntry)
				.filter(e => e.text || e.photo),
			...manualEntries,
		].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
		return {
			channel,
			title: feed.title,
			url: feed.url,
			updatedAt: Date.now(),
			entries,
			...(feed.isGroup && !feed.posts.length && !manualEntries.length
				? {
						error: 'Telegram не отдаёт посты групп. Добавьте запись вручную ниже.',
					}
				: {}),
		}
	} catch (e) {
		return {
			channel,
			title: `@${channel}`,
			url: `https://t.me/${channel}`,
			updatedAt: Date.now(),
			entries: manualEntries,
			error: manualEntries.length
				? undefined
				: (e as Error)?.message || 'Не удалось получить обновления',
		}
	}
}
