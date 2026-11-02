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
	threshold: number
	users: Record<string, StreamerEntry>
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
	const threshold =
		typeof raw?.threshold === 'number' && Number.isFinite(raw.threshold)
			? Math.max(0, Math.floor(raw.threshold))
			: DEFAULT_THRESHOLD
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
	return { threshold, users }
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
	if (followers === null) return null
	const state = await getStreamersState()
	const prev = state.users[login]
	const entry: StreamerEntry = {
		login,
		displayName: input.displayName?.trim() || prev?.displayName || login,
		avatar: avatars[login] || prev?.avatar || '',
		followers,
		// новый участник попадает в карусель сам, если прошёл порог;
		// ручной скрытый/показанный статус не перетираем
		visible: prev?.visible ?? followers >= state.threshold,
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

export async function addStreamer(login: string): Promise<StreamerEntry | null> {
	const key = login.trim().toLowerCase().replace(/^@/, '')
	if (!key) return null
	return syncStreamer({ login: key })
}

// Первый запуск после обновления: в settings ещё нет карусели, но аккаунты
// панели уже существуют. Один раз подтягиваем их подписчиков, чтобы блок
// появился без повторного входа каждого стримера.
export async function syncAllStreamers(): Promise<number> {
	const state = await getStreamersState()
	const links = await storage.getLinks()
	let changed = 0
	for (const link of links) {
		const login = link.login?.toLowerCase()
		if (!login) continue
		const [followers, avatars] = await Promise.all([
			getFollowerCount(login),
			getTwitchAvatars([login]),
		])
		if (followers === null) continue
		const prev = state.users[login]
		state.users[login] = {
			login,
			displayName: prev?.displayName || login,
			avatar: avatars[login] || prev?.avatar || '',
			followers,
			visible: prev?.visible ?? followers >= state.threshold,
			featured: prev?.featured ?? false,
			updatedAt: new Date().toISOString(),
		}
		changed += 1
	}
	if (changed) await saveStreamersState(state)
	return changed
}

export async function listAdminStreamers(): Promise<StreamersState> {
	return getStreamersState()
}

export async function listPublicStreamers(): Promise<StreamersState> {
	let state = await getStreamersState()
	// ленивый бэкфилл для уже зарегистрированных пользователей
	if (Object.keys(state.users).length === 0) {
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
