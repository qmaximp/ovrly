// Медиа-ссылки: YouTube (видео) и Twitch (канал / VOD / клип).
// Такие ссылки в iframe-элементе получают медиа-обработку (чистый кадр + свой плеер),
// остальные URL остаются обычными сайтами.

export type MediaInfo =
	| { kind: 'youtube'; id: string; live?: boolean }
	| { kind: 'twitch-channel'; channel: string }
	| { kind: 'twitch-vod'; id: string }
	| { kind: 'twitch-clip'; slug: string }

// служебные разделы twitch.tv (не каналы): встраивать их нельзя
const TWITCH_NON_CHANNEL = new Set([
	'directory',
	'search',
	'settings',
	'subscriptions',
	'inventory',
	'wallet',
	'drops',
	'friends',
	'messages',
	'jobs',
	'store',
	'product',
	'downloads',
	'turbo',
	'creatorcamp',
	'broadcast',
	'legal',
	'privacy',
	'about',
	'p',
	'activate',
	'bits',
	'payments',
	'security',
	'notifications',
	'following',
])

// сайты, которые запрещают встраивание в рамку (X-Frame-Options/frame-ancestors):
// такой «Сайт» в рамке не откроется — подсказываем это в панели
const NO_FRAME_HOSTS =
	/(^|\.)(twitch\.tv|youtube\.com|youtu\.be|google\.com|vk\.com|instagram\.com|facebook\.com|tiktok\.com|twitter\.com|x\.com)$/i

export function cannotBeFramed(raw: string): boolean {
	try {
		const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
		return NO_FRAME_HOSTS.test(u.hostname)
	} catch {
		return false
	}
}

export function parseMediaUrl(raw: string): MediaInfo | null {
	const url = (raw || '').trim()
	if (!url) return null
	const withProto = /^https?:\/\//i.test(url) ? url : 'https://' + url
	try {
		const u = new URL(withProto)
		const host = u.hostname.toLowerCase().replace(/^www\./, '')
		if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
			let id = ''
			let live = false
			if (u.pathname === '/watch') id = u.searchParams.get('v') || ''
			else if (u.pathname.startsWith('/live/')) {
				id = u.pathname.split('/')[2] || ''
				live = true
			} else if (u.pathname.startsWith('/embed/') || u.pathname.startsWith('/shorts/'))
				id = u.pathname.split('/')[2] || ''
			return id ? { kind: 'youtube', id, live } : null
		}
		if (host === 'youtu.be') {
			const id = u.pathname.slice(1).split('/')[0]
			return id ? { kind: 'youtube', id } : null
		}
		if (host === 'twitch.tv' || host === 'm.twitch.tv') {
			const parts = u.pathname.split('/').filter(Boolean)
			const seg = (parts[0] || '').toLowerCase()
			if (!seg) return null
			// служебные разделы — НЕ каналы: раньше они превращались в канал с именем
			// «directory»/«videos», плеер не находил такой канал и оставался пустым
			if (TWITCH_NON_CHANNEL.has(seg)) return null
			// /videos/<id> и /videos/<id>?t=... — запись трансляции
			if (seg === 'videos')
				return parts[1] ? { kind: 'twitch-vod', id: parts[1].replace(/^v/, '') } : null
			// /clip/<slug> — клип
			if (seg === 'clip')
				return parts[1] ? { kind: 'twitch-clip', slug: parts[1] } : null
			// канал + подпуть: /канал/clip/<slug> — это клип канала, /канал/videos — канал
			if ((parts[1] || '').toLowerCase() === 'clip' && parts[2])
				return { kind: 'twitch-clip', slug: parts[2] }
			return { kind: 'twitch-channel', channel: seg }
		}
		if (host === 'clips.twitch.tv') {
			const slug = u.pathname.slice(1).split('/')[0]
			return slug ? { kind: 'twitch-clip', slug } : null
		}
		if (host === 'player.twitch.tv') {
			const clip = u.searchParams.get('clip')
			const vid = u.searchParams.get('video')
			const ch = u.searchParams.get('channel')
			if (clip) return { kind: 'twitch-clip', slug: clip }
			if (vid) return { kind: 'twitch-vod', id: vid.replace(/^v/, '') }
			if (ch) return { kind: 'twitch-channel', channel: ch.toLowerCase() }
			const parts = u.pathname.split('/').filter(Boolean)
			if (parts[0] === 'videos' && parts[1]) return { kind: 'twitch-vod', id: parts[1].replace(/^v/, '') }
			if (parts[0]) return { kind: 'twitch-channel', channel: parts[0].toLowerCase() }
			return null
		}
		return null
	} catch {
		return null
	}
}

export function isMediaUrl(raw: string): boolean {
	return parseMediaUrl(raw) !== null
}

// короткий отпечаток строки (для ключа источника файлов с ПК: сами data-URL
// тащить в состояние плеера нельзя — они мегабайтные)
function shortHash(s: string): string {
	let h = 5381
	for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
	return h.toString(36)
}

// ключ источника для состояния плеера. Панель и плашка управления считают его
// одной и той же функцией — по нему видно, относится ли состояние к текущей ссылке
// (после смены src прежнее состояние к новому источнику применять нельзя)
export function mediaKeyFor(el: { src?: string }): string {
	const src = el.src || ''
	const info = parseMediaUrl(src)
	if (info) {
		if (info.kind === 'youtube') return 'youtube:' + info.id
		if (info.kind === 'twitch-channel') return 'twitch:channel:' + info.channel
		if (info.kind === 'twitch-vod') return 'twitch:vod:' + info.id
		return 'twitch:clip:' + info.slug
	}
	return src ? `file:${src.length}:${shortHash(src)}` : ''
}

// origin ОБЯЗАТЕЛЕН: без него YouTube молча игнорирует postMessage-команды
// и не присылает состояние плеера. mute=1 обязателен: программный play() со звуком
// без жеста пользователя браузер блокирует — стартуем без звука, звук включается
// кнопкой в панели и ретранслируется на оверлей.
// cc_load_policy=0 — субтитры не включаются сами.
// Домен youtube-nocookie: без cookie/аккаунта YouTube, иначе плеер применяет личные
// настройки зрителя (в т.ч. «субтитры всегда включены») и субтитры лезут в кадр.
// Дополнительно субтитры принудительно глушатся командами (см. PanelClient/OverlayClient)
export function youtubeEmbedUrl(
	id: string,
	origin: string,
	muted = true,
	autoplay = false,
): string {
	const p = new URLSearchParams({
		enablejsapi: '1',
		controls: '0',
		rel: '0',
		iv_load_policy: '3',
		cc_load_policy: '0',
		disablekb: '1',
		origin,
	})
	if (muted) p.set('mute', '1')
	// autoplay+mute: браузер разрешает автозапуск без жеста, только без звука
	if (autoplay) p.set('autoplay', '1')
	return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`
}

// iframe Twitch без родных контролов (для страниц, где API не нужен)
export function twitchEmbedUrl(info: NonNullable<MediaInfo>, parent: string): string {
	const p = new URLSearchParams({ parent, controls: 'false' })
	if (info.kind === 'twitch-channel') p.set('channel', info.channel)
	if (info.kind === 'twitch-vod') p.set('video', info.id)
	if (info.kind === 'twitch-clip') p.set('clip', info.slug)
	return `https://player.twitch.tv?${p.toString()}`
}

// Twitch SDK (embed.twitch.tv/embed/v1.js) — единственный способ управлять
// плеером Twitch из JS (postMessage-команд у player.twitch.tv нет)
export function loadTwitchSdk(): Promise<any> {
	const w = window as any
	if (w.Twitch?.Player) return Promise.resolve(w.Twitch)
	return new Promise((res, rej) => {
		const s = document.createElement('script')
		s.src = 'https://embed.twitch.tv/embed/v1.js'
		s.onload = () => (w.Twitch?.Player ? res(w.Twitch) : rej(new Error('twitch sdk: нет Twitch.Player')))
		s.onerror = () => rej(new Error('twitch sdk: не загрузился'))
		document.head.appendChild(s)
	})
}

// Живая ссылка (трансляция канала или YouTube-лейв): такую ссылку логично
// запускать сразу после вставки, а не ждать нажатия play
export function isLiveLink(raw: string): boolean {
	const info = parseMediaUrl(raw)
	if (!info) return false
	return info.kind === 'twitch-channel' || (info.kind === 'youtube' && !!info.live)
}
