import { NextResponse } from 'next/server'
import * as storage from '@/lib/storage'
import { clientIp, rateLimit } from '@/lib/api'
import { normalizeTelegramChannel } from '@/lib/telegram'
import { loadTelegramChannel } from '@/lib/telegramFeed'

// Свежесть кэша, который наполняет мост на ПК (сервер в РФ не видит t.me).
const CACHE_TTL = 10 * 60 * 1000
const cacheKey = (channel: string) => `tgcache:${channel}`

type Cached = { at: number; data: unknown }

export async function GET(req: Request) {
	if (!rateLimit(`tg:${clientIp(req)}`, 30, 60_000))
		return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 })
	const raw = new URL(req.url).searchParams.get('channel') || ''
	const channel = normalizeTelegramChannel(raw)
	if (!channel)
		return NextResponse.json({ error: 'Укажите Telegram-канал' }, { status: 400 })
	try {
		const hit = (await storage.getSetting<Cached>(cacheKey(channel))) || null
		if (hit && Date.now() - hit.at < CACHE_TTL)
			return NextResponse.json(hit.data, {
				headers: { 'Cache-Control': 'public, max-age=60' },
			})
		// Кэша нет или он старый: просим мост на ПК обновить канал (он видит t.me).
		await storage.setSetting(`tgneed:${channel}`, Date.now())
		// Прод за блокировкой: сами в t.me не ходим, иначе каждый запрос висит
		// до таймаута. Отвечаем сразу, а канал подтянет мост с ПК.
		if (process.env.TELEGRAM_VIA_BRIDGE === '1') {
			if (hit)
				return NextResponse.json(hit.data, {
					headers: { 'Cache-Control': 'no-store' },
				})
			return NextResponse.json(
				{ pending: true },
				{ status: 202, headers: { 'Cache-Control': 'no-store' } },
			)
		}
		const data = await loadTelegramChannel(channel)
		await storage.setSetting(cacheKey(channel), { at: Date.now(), data })
		await storage.setSetting(`tgneed:${channel}`, 0)
		return NextResponse.json(data, {
			headers: {
				'Cache-Control': 'public, max-age=300',
				'Access-Control-Allow-Origin': '*',
			},
		})
	} catch (e) {
		// t.me недоступен (блокировка у хостинга) — отдаём что успел сохранить мост.
		const stale = (await storage.getSetting<Cached>(cacheKey(channel))) || null
		if (stale) return NextResponse.json(stale.data, { headers: { 'Cache-Control': 'public, max-age=60' } })
		const message = (e as Error)?.message || ''
		if (message.includes('Канал не найден'))
			return NextResponse.json({ error: message }, { status: 404 })
		return NextResponse.json(
			{ error: 'Не удалось получить данные Telegram' },
			{ status: 502 },
		)
	}
}
