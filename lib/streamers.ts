import * as storage from './storage'
import { getFollowerCount, getTwitchAvatars } from './twitch'

// Стримеры, которых показываем на главной. Список живёт в settings под одним
// ключом: JSON-файл в разработке и jsonb в Postgres — без отдельной миграции.
export type StreamerEntry = {
	login: string
	displayName: string
	avatar: string
	followers: number
	visible: boolean
	featured: boolean
	updatedAt: string
}

export type StreamersState = {
	version?: number
	threshold: number
	users: Record<string, StreamerEntry>
	// логины, удалённые вручную: автосинхронизация не должна их возвращать
	blocked?: string[]
}

const KEY = 'streamers'
export const DEFAULT_THRESHOLD = 50

function normalize(value: unknown): StreamersState {
	let raw: any = value
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw)
		} catch {
			raw = null
		}
	}
	let threshold =
		typeof raw?.threshold === 'number' && Number.isFinite(raw.threshold)
			? Math.max(0, Math.floor(raw.threshold))
			: DEFAULT_THRESHOLD
	// Миграция 2.2.1: раньше порог по умолчанию был 100. Если состояние ещё
	// не помечено новой версией, 100 — это старое значение по умолчанию.
	if (raw?.version !== 2 && threshold === 100) threshold = DEFAULT_THRESHOLD
	const users: Record<string, StreamerEntry> = {}
	for (const [login, item] of Object.entries<any>(raw?.users || {})) {
		if (!item || typeof item !== 'object') continue
		users[login] = {
			login,
			displayName: String(item.displayName || login),
			avatar: String(item.avatar || ''),
			followers: Number(item.followers) || 0,
			visible: item.visible !== false,
			featured: !!item.featured,
			updatedAt: String(item.updatedAt || new Date().toISOString()),
		}
	}
	const blocked = Array.isArray(raw?.blocked)
		? raw.blocked.map((l: unknown) => String(l).toLowerCase())
		: []
	return { version: 5, threshold, users, blocked }
}

export async function getStreamersState(): Promise<StreamersState> {
	return normalize(await storage.getSetting(KEY))
}

async function saveStreamersState(state: StreamersState): Promise<void> {
	await storage.setSetting(KEY, state)
}

export async function setThreshold(threshold: number): Promise<StreamersState> {
	const state = await getStreamersState()
	state.threshold = Math.max(0, Math.floor(Number(threshold) || 0))
	await saveStreamersState(state)
	return state
}

export async function syncStreamer(input: {
	login: string
	displayName?: string
}): Promise<StreamerEntry | null> {
	const login = input.login.trim().toLowerCase()
	if (!login) return null
	const [followers, avatars] = await Promise.all([
		getFollowerCount(login),
		getTwitchAvatars([login]),
	])
	const state = await getStreamersState()
	if (state.blocked?.includes(login)) return null
	const prev = state.users[login]
	const entry: StreamerEntry = {
		login,
		displayName: input.displayName?.trim() || prev?.displayName || login,
		avatar: avatars[login] || prev?.avatar || '',
		followers: followers ?? prev?.followers ?? 0,
		// все зарегистрированные видны сразу; ручной скрытый/показанный
		// статус из админки не перетираем
		visible: prev?.visible ?? true,
		featured: prev?.featured ?? false,
		updatedAt: new Date().toISOString(),
	}
	state.users[login] = entry
	await saveStreamersState(state)
	return entry
}

export async function updateStreamer(
	login: string,
	patch: Partial<Pick<StreamerEntry, 'visible' | 'featured' | 'followers'>>,
): Promise<StreamersState> {
	const state = await getStreamersState()
	const key = login.toLowerCase()
	const prev = state.users[key]
	if (!prev) return state
	state.users[key] = {
		...prev,
		...patch,
		followers:
			typeof patch.followers === 'number'
				? Math.max(0, Math.floor(patch.followers))
				: prev.followers,
		updatedAt: new Date().toISOString(),
	}
	await saveStreamersState(state)
	return state
}

export async function removeStreamer(login: string): Promise<StreamersState> {
	const state = await getStreamersState()
	const key = login.trim().toLowerCase()
	delete state.users[key]
	state.blocked = [...new Set([...(state.blocked || []), key])]
	await saveStreamersState(state)
	return state
}

export async function addStreamer(login: string): Promise<StreamerEntry | null> {
	const key = login.trim().toLowerCase().replace(/^@/, '')
	if (!key) return null
	const state = await getStreamersState()
	if (state.blocked?.includes(key)) {
		state.blocked = state.blocked.filter(l => l !== key)
		await saveStreamersState(state)
	}
	return syncStreamer({ login: key })
}

// Первый запуск после обновления: в settings ещё нет карусели, но аккаунты
// панели уже существуют. Один раз подтягиваем их подписчиков, чтобы блок
// появился без повторного входа каждого стримера.
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out = new Array<R>(items.length)
	let next = 0
	async function worker() {
		while (next < items.length) {
			const index = next++
			out[index] = await fn(items[index])
		}
	}
	const workers = Array.from(
		{ length: Math.min(Math.max(1, limit), items.length) },
		worker,
	)
	await Promise.all(workers)
	return out
}

export async function syncAllStreamers(): Promise<number> {
	const state = await getStreamersState()
	// Все аккаунты берём из БД (links): не только те, кто зашёл после обновления.
	const links = await storage.getLinks()
	const blocked = new Set(state.blocked || [])
	const logins = [
		...new Set(links.map(l => l.login?.toLowerCase()).filter(Boolean)),
	].filter(login => !blocked.has(login as string)) as string[]
	if (!logins.length) return 0

	// Аватары — одним запросом Helix, подписчиков — параллельно по 8.
	const avatars = await getTwitchAvatars(logins)
	const followers = await mapLimit(logins, 8, login => getFollowerCount(login))

	logins.forEach((login, i) => {
		const prev = state.users[login]
		const count = followers[i] ?? prev?.followers ?? 0
		state.users[login] = {
			login,
			displayName: prev?.displayName || login,
			avatar: avatars[login] || prev?.avatar || '',
			followers: count,
			visible: prev?.visible ?? count >= state.threshold,
			featured: prev?.featured ?? false,
			updatedAt: new Date().toISOString(),
		}
	})
	await saveStreamersState(state)
	return logins.length
}

export async function listAdminStreamers(): Promise<StreamersState> {
	return getStreamersState()
}

export async function listPublicStreamers(): Promise<StreamersState> {
	let state = await getStreamersState()
	// Ленивый бэкфилл: состояния до версии 4 не содержали всех аккаунтов из БД.
	let raw: any = await storage.getSetting(KEY)
	// в Postgres значение приходит строкой JSON, в JSON-хранилище — объектом
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw)
		} catch {
			raw = null
		}
	}
	if (!raw || raw.version !== 5) {
		await syncAllStreamers()
		state = await getStreamersState()
	}
	const users = Object.values(state.users)
		.filter(u => u.visible && u.followers >= state.threshold)
		.sort((a, b) => {
			if (a.featured !== b.featured) return a.featured ? -1 : 1
			return b.followers - a.followers || a.login.localeCompare(b.login)
		})
	return { threshold: state.threshold, users: Object.fromEntries(users.map(u => [u.login, u])) }
}
