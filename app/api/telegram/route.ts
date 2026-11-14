import { NextResponse } from 'next/server'
import { clientIp, rateLimit } from '@/lib/api'
import { normalizeTelegramChannel } from '@/lib/telegram'
import { loadTelegramChannel } from '@/lib/telegramFeed'

// Публичная карточка Telegram-канала для оверлея: последние посты, подписчики,
// аватар и ссылка. Разбор и кэш — в lib/telegramFeed.
export async function GET(req: Request) {
	// Публичный прокси к t.me: ограничиваем, чтобы им не качали чужие каналы пачками.
	if (!rateLimit(`tg:${clientIp(req)}`, 30, 60_000))
		return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 })
	const raw = new URL(req.url).searchParams.get('channel') || ''
	const channel = normalizeTelegramChannel(raw)
	if (!channel) {
		return NextResponse.json(
			{ error: 'Укажите Telegram-канал' },
			{ status: 400 },
		)
	}
	try {
		const data = await loadTelegramChannel(channel)
		return NextResponse.json(data, {
			headers: {
				'Cache-Control': 'public, max-age=300',
				'Access-Control-Allow-Origin': '*',
			},
		})
	} catch (e) {
		const message = (e as Error)?.message || ''
		if (message.includes('Канал не найден'))
			return NextResponse.json({ error: message }, { status: 404 })
		return NextResponse.json(
			{ error: 'Не удалось получить данные Telegram' },
			{ status: 502 },
		)
	}
}
