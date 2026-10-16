// Смайлики для панели: Twitch (глобальные, канальные и личные набора автора),
// 7TV, BetterTTV и FrankerFaceZ.
//
// Логика специально простая и предсказуемая:
//   1. Канальные смайлики Twitch и наборы сторонних платформ берутся по каналу —
//      для этого достаточно app-токена Twitch, вход автора не нужен.
//   2. Полный личный набор автора (смайлики его подписок, награды канала) можно
//      получить только его user-токеном — он лежит в links.json с момента входа
//      автора через Twitch и обновляется по refresh_token.
//   3. Если личного токена нет (автор ни разу не входил или отозвал доступ) —
//      отдаём всё, что доступно публично, и пишем об этом в notes.
//
// Результат кэшируется на 5 минут: пикер открывается часто, а платформы
// ограничивают частоту запросов.

import { readLinks, writeLinks } from './links'
import { getAppToken, safe, twitchUserId } from './twitch'

export type Emote = {
	platform: 'twitch' | '7tv' | 'bttv' | 'ffz'
	code: string
	url: string
	// откуда смайлик: канал / личный набор автора / глобальный набор платформы
	scope: 'channel' | 'personal' | 'global'
}

export type EmotesResult = {
	channel: string
	ownerToken: boolean
	emotes: Emote[]
	notes: string[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; data: EmotesResult }>()

// Helix-запрос конкретным токеном (app- или user-). Возвращает null при любой ошибке:
// смайлики — необязательная часть, падать из-за них нельзя
async function helix(path: string, token: string | null): Promise<any | null> {
	const cid = process.env.TWITCH_CLIENT_ID
	if (!token || !cid) return null
	const res = await safe(() =>
		fetch(`https://api.twitch.tv/helix/${path}`, {
			headers: { 'Client-Id': cid, Authorization: `Bearer ${token}` },
			cache: 'no-store',
			signal: AbortSignal.timeout(8000),
		}),
	)
	if (!res || !res.ok) return null
	return safe(() => res.json())
}

// Личный user-токен автора канала: из links.json, при истечении — по refresh_token.
// Обновлённый токен сохраняем обратно, чтобы им пользовался и весь остальной код
async function ownerUserToken(channel: string): Promise<string | null> {
	const links = readLinks()
	const entry = links[channel]
	if (!entry) return null
	if (entry.userToken && (entry.userTokenExpires ?? 0) > Date.now() + 60_000)
		return entry.userToken
	if (!entry.refreshToken) return null
	const cid = process.env.TWITCH_CLIENT_ID
	const sec = process.env.TWITCH_CLIENT_SECRET
	if (!cid || !sec) return null
	const refreshed = await safe(() =>
		fetch('https://id.twitch.tv/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: cid,
				client_secret: sec,
				grant_type: 'refresh_token',
				refresh_token: entry.refreshToken!,
			}),
			cache: 'no-store',
		}).then(r => r.json()),
	)
	if (!refreshed?.access_token) return null
	const fresh = readLinks() // перечитываем: файл мог обновиться параллельно
	fresh[channel] = {
		...fresh[channel],
		userToken: refreshed.access_token,
		userTokenExpires: Date.now() + (refreshed.expires_in ?? 14400) * 1000,
		refreshToken: refreshed.refresh_token ?? entry.refreshToken,
	}
	writeLinks(fresh)
	return refreshed.access_token as string
}

// --- платформы ---

async function twitchEmotes(
	broadcasterId: string | null,
	ownerToken: string | null,
	notes: string[],
): Promise<Emote[]> {
	const out: Emote[] = []
	const seen = new Set<string>()
	const push = (e: any, scope: Emote['scope']) => {
		const url =
			e?.images?.url_4x || e?.images?.url_2x || e?.images?.url_1x
		if (!url || !e?.name) return
		const key = `twitch|${e.name}`
		if (seen.has(key)) return
		seen.add(key)
		out.push({ platform: 'twitch', code: e.name, url, scope })
	}

	const appToken = await getAppToken()
	if (!appToken) {
		notes.push(
			'Twitch недоступен: не заданы TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET (см. .env.local)',
		)
		return out
	}

	// 1) личный набор автора: его подписки и награды канала (только его токеном)
	if (ownerToken && broadcasterId) {
		const own = await helix(
			`chat/emotes/user?user_id=${broadcasterId}`,
			ownerToken,
		)
		for (const e of own?.data ?? []) push(e, 'personal')
	}

	// 2) смайлики самого канала. Важно: публичный эндпоинт — старый
	//    /chat/emotes?broadcaster_id=... (работает с app-токеном), а новый
	//    /chat/emotes/channel требует user-токен и с app-токеном отдаёт 404.
	//    Поэтому базовый набор берём старым запросом, а «новый» добавляем, если
	//    есть токен автора (там полнее метаданные)
	if (broadcasterId) {
		const ch = await helix(`chat/emotes?broadcaster_id=${broadcasterId}`, appToken)
		for (const e of ch?.data ?? []) push(e, 'channel')
		if (ownerToken) {
			const chNew = await helix(
				`chat/emotes/channel?broadcaster_id=${broadcasterId}`,
				ownerToken,
			)
			for (const e of chNew?.data ?? []) push(e, 'channel')
		}
	}

	// 3) глобальные смайлики Twitch
	const glob = await helix('chat/emotes/global', appToken)
	for (const e of glob?.data ?? []) push(e, 'global')

	return out
}

function sevenTvFile(host: any): string | null {
	if (!host?.url) return null
	const files: string[] = (host.files ?? []).map((f: any) => f.name)
	return (
		files.find(n => n === '3x.webp') ||
		files.find(n => n === '2x.webp') ||
		files.find(n => n === '4x.webp') ||
		files.find(n => n === '1x.webp') ||
		files[0] ||
		null
	)
}

async function sevenTv(broadcasterId: string | null, notes: string[]): Promise<Emote[]> {
	const out: Emote[] = []
	const url = (e: any): string | null => {
		const file = sevenTvFile(e?.data?.host)
		return file ? `https:${e.data.host.url}/${file}` : null
	}
	const g = await safe(() =>
		fetch('https://7tv.io/v3/emote-sets/global', {
			cache: 'no-store',
			signal: AbortSignal.timeout(8000),
		}).then(r => r.json()),
	)
	for (const e of g?.emotes ?? []) {
		const u = url(e)
		if (u) out.push({ platform: '7tv', code: e.name, url: u, scope: 'global' })
	}
	if (broadcasterId) {
		// null (запрос не прошёл) — это сеть/блокировка, а НЕ «набор не подключён»:
		// не путаем эти случаи, иначе автор идёт подключать то, что уже подключено
		const u = await safe(() =>
			fetch(`https://7tv.io/v3/users/twitch/${broadcasterId}`, {
				cache: 'no-store',
				signal: AbortSignal.timeout(8000),
			}).then(r => r.json()),
		)
		if (u === null) {
			notes.push('7TV недоступен (сеть или блокировка) — смайлики 7TV пропущены')
		} else if (u.error_code) {
			notes.push(
				'7TV: у канала нет подключённого набора — автор должен зайти на 7tv.app через Twitch (Connections), и смайлики появятся',
			)
		} else {
			for (const e of u?.emote_set?.emotes ?? []) {
				const eu = url(e)
				if (eu)
					out.push({ platform: '7tv', code: e.name, url: eu, scope: 'channel' })
			}
		}
	}
	return out
}

async function bttv(broadcasterId: string | null): Promise<Emote[]> {
	const out: Emote[] = []
	const push = (arr: any, scope: Emote['scope']) => {
		for (const e of arr ?? []) {
			if (e?.id && e?.code)
				out.push({
					platform: 'bttv',
					code: e.code,
					url: `https://cdn.betterttv.net/emote/${e.id}/3x`,
					scope,
				})
		}
	}
	const g = await safe(() =>
		fetch('https://api.betterttv.net/3/cached/emotes/global', {
			cache: 'no-store',
			signal: AbortSignal.timeout(8000),
		}).then(r => r.json()),
	)
	push(g, 'global')
	if (broadcasterId) {
		const u = await safe(() =>
			fetch(`https://api.betterttv.net/3/cached/users/twitch/${broadcasterId}`, {
				cache: 'no-store',
				signal: AbortSignal.timeout(8000),
			}).then(r => r.json()),
		)
		push(u?.channelEmotes, 'channel')
		push(u?.sharedEmotes, 'channel')
	}
	return out
}

async function ffz(broadcasterId: string | null): Promise<Emote[]> {
	const out: Emote[] = []
	const parseSets = (sets: any, scope: Emote['scope']) => {
		for (const set of Object.values(sets ?? {})) {
			for (const e of (set as any)?.emoticons ?? []) {
				const u = e?.urls?.['4'] || e?.urls?.['2'] || e?.urls?.['1']
				if (u)
					out.push({
						platform: 'ffz',
						code: e.name,
						url: u.startsWith('//') ? `https:${u}` : u,
						scope,
					})
			}
		}
	}
	const g = await safe(() =>
		fetch('https://api.frankerfacez.com/v1/set/global', {
			cache: 'no-store',
			signal: AbortSignal.timeout(8000),
		}).then(r => r.json()),
	)
	parseSets(g?.sets, 'global')
	if (broadcasterId) {
		const r = await safe(() =>
			fetch(`https://api.frankerfacez.com/v1/room/id/${broadcasterId}`, {
				cache: 'no-store',
				signal: AbortSignal.timeout(8000),
			}).then(x => x.json()),
		)
		parseSets(r?.sets, 'channel')
	}
	return out
}

// Главная функция: собрать всё, схлопнуть дубликаты, отсортировать платформы
export async function loadEmotes(channel: string, refresh = false): Promise<EmotesResult> {
	const key = channel || '__global__'
	if (!refresh) {
		const hit = cache.get(key)
		if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data
	}

	const notes: string[] = []
	const broadcasterId = channel ? await twitchUserId(channel) : null
	const ownerToken = channel ? await ownerUserToken(channel) : null
	if (channel && !ownerToken)
		notes.push(
			'Полный набор автора недоступен: чтобы подтянулись его подписки и награды канала, автор должен войти в панель через Twitch',
		)

	const [t, s7, b, f] = await Promise.all([
		safe(() => twitchEmotes(broadcasterId, ownerToken, notes)),
		safe(() => sevenTv(broadcasterId, notes)),
		safe(() => bttv(broadcasterId)),
		safe(() => ffz(broadcasterId)),
	])

	// порядок: личные и канальные вперёд глобальных — при совпадении имён побеждает
	// «свой» смайлик (у каналов часто переопределяют глобальные)
	const order: Record<Emote['scope'], number> = { personal: 0, channel: 1, global: 2 }
	const all = [...(t ?? []), ...(s7 ?? []), ...(b ?? []), ...(f ?? [])].sort(
		(a, b2) => order[a.scope] - order[b2.scope],
	)

	const seen = new Set<string>()
	const emotes = all.filter(e => {
		const k = `${e.platform}|${e.code}`
		if (seen.has(k)) return false
		seen.add(k)
		return true
	})

	const data: EmotesResult = {
		channel,
		ownerToken: !!ownerToken,
		emotes,
		notes: [...new Set(notes)],
	}
	cache.set(key, { at: Date.now(), data })
	return data
}
