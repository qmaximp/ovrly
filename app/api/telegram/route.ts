import { NextResponse } from 'next/server'
import { normalizeTelegramChannel } from '@/lib/telegram'

// Публичная карточка Telegram-канала для оверлея: последний пост, подписчики,
// аватар и ссылка. Данные берём с публичной веб-версии t.me и кэшируем на 5 минут.
type TelegramData = {
	channel: string
	title: string
	subscribers: string
	description: string
	avatar: string
	url: string
	last?: {
		text: string
		photo: string
		date: string
		views: string
		url: string
	}
}

const CACHE_TTL = 5 * 60 * 1000
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

	const start = html.lastIndexOf('tgme_widget_message_wrap')
	const chunk = start >= 0 ? html.slice(start) : ''
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
	const url = postId
		? `https://t.me/${postId}`
		: `https://t.me/${channel}`

	return {
		channel,
		title: decodeEntities(ogTitle || channel),
		subscribers,
		description,
		avatar,
		url: `https://t.me/${channel}`,
		last:
			text || photo || timeText
				? { text, photo, date: timeText || date, views, url }
				: undefined,
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
	const hit = cache.get(channel)
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
		cache.set(channel, { at: Date.now(), data })
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
