import { NextResponse } from 'next/server'
import { normalizeTelegramChannel } from '@/lib/telegram'

// Публичная карточка Telegram-канала для оверлея: последний пост, подписчики,
// аватар и ссылка. Данные берём с публичной веб-версии t.me и кэшируем на 5 минут.
type TelegramMedia = {
	kind: 'photo' | 'video' | 'round' | 'sticker' | 'voice' | 'file'
	url: string
	thumb?: string
	title?: string
}

type TelegramPost = {
	text: string
	photo: string
	media?: TelegramMedia[]
	date: string
	views: string
	url: string
}

type TelegramData = {
	channel: string
	title: string
	subscribers: string
	description: string
	avatar: string
	url: string
	posts: TelegramPost[]
	last?: TelegramPost
}

const CACHE_TTL = 5 * 60 * 1000
const CACHE_VERSION = 3
const cache = new Map<string, { at: number; data: TelegramData }>()

function decodeEntities(s: string): string {
	return s
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function plainText(html: string): string {
	const noTags = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
	return decodeEntities(noTags).replace(/\s+/g, ' ').trim()
}

function firstMatch(html: string, re: RegExp): string {
	return html.match(re)?.[1] || ''
}

function parseTelegram(html: string, channel: string): TelegramData {
	const ogTitle = firstMatch(html, /<meta property="og:title" content="([^"]+)"/)
	const ogImage = firstMatch(html, /<meta property="og:image" content="([^"]+)"/)
	const description = decodeEntities(
		firstMatch(html, /<meta property="og:description" content="([^"]+)"/),
	)

	let subscribers = ''
	for (const m of html.matchAll(
		/<div class="tgme_channel_info_counter">[\s\S]*?<span class="counter_value">([^<]+)<\/span>[\s\S]*?<span class="counter_type">([^<]+)<\/span>/g,
	)) {
		const type = decodeEntities(plainText(m[2])).toLowerCase()
		if (type.includes('подпис') || type.includes('subscriber')) {
			subscribers = decodeEntities(plainText(m[1]))
			break
		}
	}

	const avatar =
		firstMatch(
			html,
			/tgme_page_photo_image[^>]*background-image:url\('([^']+)'\)/,
		) || ogImage

	const chunks = html.split('tgme_widget_message_wrap').slice(1)
	const parseMedia = (chunk: string): TelegramMedia[] => {
		const out: TelegramMedia[] = []
		const seen = new Set<string>()
		const add = (m: TelegramMedia) => {
			if (!m.url || seen.has(m.url)) return
			seen.add(m.url)
			out.push(m)
		}
		for (const m of chunk.matchAll(
			/<a class="tgme_widget_message_photo_wrap[^"]*"[^>]*background-image:url\('([^']+)'\)/g,
		))
			add({ kind: 'photo', url: m[1] })
		for (const m of chunk.matchAll(
			/<i class="tgme_widget_message_sticker[^"]*"[^>]*background-image:url\('([^']+)'\)/g,
		))
			add({ kind: 'sticker', url: m[1] })
		for (const m of chunk.matchAll(/<video\b[^>]*>/gi)) {
			const tag = m[0]
			const url = tag.match(/\bsrc="([^"]+)"/)?.[1] || ''
			const kind = /roundvideo|round_video/i.test(tag)
				? 'round'
				: /gif/i.test(tag)
					? 'video'
					: 'video'
			if (url) add({ kind, url })
		}
		for (const m of chunk.matchAll(/<audio\b[^>]*src="([^"]+)"[^>]*>/gi))
			add({ kind: 'voice', url: m[1] })
		for (const m of chunk.matchAll(
			/<a class="tgme_widget_message_document_wrap"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
		)) {
			const title = plainText(m[2])
			add({ kind: 'file', url: m[1], title })
		}
		return out.slice(0, 6)
	}
	const parseChunk = (chunk: string): TelegramPost | null => {
		const media = parseMedia(chunk)
		const text = plainText(
			firstMatch(
				chunk,
				/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
			),
		)
		const photo = firstMatch(
			chunk,
			/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/,
		)
		const date = firstMatch(chunk, /<time[^>]*datetime="([^"]+)"/)
		const timeText = plainText(
			firstMatch(chunk, /<time[^>]*>[\s\S]*?<\/time>/),
		)
		const views = plainText(
			firstMatch(chunk, /tgme_widget_message_views[^>]*>([^<]+)</),
		)
		const postId = firstMatch(chunk, /data-post="([^"]+)"/)
		if (!text && !photo && !timeText && !media.length) return null
		return {
			text,
			photo: photo || media.find(m => m.kind === 'photo')?.url || '',
			media,
			date: timeText || date,
			views,
			url: postId ? `https://t.me/${postId}` : `https://t.me/${channel}`,
		}
	}

	const posts = chunks
		.slice(-8)
		.map(parseChunk)
		.filter((p): p is TelegramPost => !!p)
		.sort((a, b) => {
			const at = Date.parse(a.date) || 0
			const bt = Date.parse(b.date) || 0
			return at - bt
		})
	const last = posts[posts.length - 1] || undefined

	return {
		channel,
		title: decodeEntities(ogTitle || channel),
		subscribers,
		description,
		avatar,
		url: `https://t.me/${channel}`,
		posts,
		last,
	}
}

export async function GET(req: Request) {
	const raw = new URL(req.url).searchParams.get('channel') || ''
	const channel = normalizeTelegramChannel(raw)
	if (!channel) {
		return NextResponse.json(
			{ error: 'Укажите Telegram-канал' },
			{ status: 400 },
		)
	}
	const cacheKey = `${channel}:v${CACHE_VERSION}`
	const hit = cache.get(cacheKey)
	if (hit && Date.now() - hit.at < CACHE_TTL) {
		return NextResponse.json(hit.data, {
			headers: { 'Cache-Control': 'public, max-age=300' },
		})
	}
	try {
		const res = await fetch(`https://t.me/s/${channel}`, {
			headers: {
				'user-agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
				'accept-language': 'ru,en;q=0.9',
			},
			signal: AbortSignal.timeout(9000),
			cache: 'no-store',
		})
		if (!res.ok) throw new Error(`t.me ${res.status}`)
		const html = await res.text()
		const data = parseTelegram(html, channel)
		if (!data.title || data.title === channel) {
			// пустой/несуществующий канал
			return NextResponse.json(
				{ error: 'Канал не найден или закрыт' },
				{ status: 404 },
			)
		}
		cache.set(cacheKey, { at: Date.now(), data })
		return NextResponse.json(data, {
			headers: {
				'Cache-Control': 'public, max-age=300',
				'Access-Control-Allow-Origin': '*',
			},
		})
	} catch {
		return NextResponse.json(
			{ error: 'Не удалось получить данные Telegram' },
			{ status: 502 },
		)
	}
}
