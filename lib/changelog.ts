import * as storage from './storage'
import { normalizeTelegramChannel } from './telegram'
import { loadTelegramChannel, type TelegramPost } from './telegramFeed'

export type ChangelogEntry = {
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
export async function loadChangelog(): Promise<ChangelogData> {
	const channel = await getChangelogChannel()
	if (!channel) {
		return {
			channel: '',
			title: '',
			url: '',
			updatedAt: Date.now(),
			entries: [],
		}
	}
	try {
		const feed = await loadTelegramChannel(channel)
		return {
			channel,
			title: feed.title,
			url: feed.url,
			updatedAt: Date.now(),
			entries: feed.posts
				.slice()
				.reverse()
				.map(toEntry)
				.filter(e => e.text || e.photo),
		}
	} catch (e) {
		return {
			channel,
			title: `@${channel}`,
			url: `https://t.me/${channel}`,
			updatedAt: Date.now(),
			entries: [],
			error: (e as Error)?.message || 'Не удалось получить обновления',
		}
	}
}
