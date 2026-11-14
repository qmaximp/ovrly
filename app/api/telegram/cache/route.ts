import { NextResponse } from 'next/server'
import * as storage from '@/lib/storage'
import { normalizeTelegramChannel } from '@/lib/telegram'
import { parseTelegramHtml } from '@/lib/telegramFeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Мост на ПК стримера присылает сюда HTML страницы t.me/s/<канал>, сервер его
// разбирает и кладёт в кэш: сам сервер до Telegram достучаться не может.
export async function POST(req: Request) {
	const secret = process.env.TELEGRAM_WEBHOOK_SECRET || ''
	if (!secret) return NextResponse.json({ error: 'note' }, { status: 503 })
	if (req.headers.get('x-ovrly-secret') !== secret)
		return NextResponse.json({ error: 'forbidden' }, { status: 403 })
	const body = (await req.json().catch(() => null)) as { channel?: string; html?: string } | null
	const channel = normalizeTelegramChannel(body?.channel || '')
	if (!channel || !body?.html)
		return NextResponse.json({ error: 'bad request' }, { status: 400 })
	try {
		const data = parseTelegramHtml(body.html, channel)
		if (!data.title || data.title === channel)
			return NextResponse.json({ error: 'Канал не найден или закрыт' }, { status: 404 })
		await storage.setSetting(`tgcache:${channel}`, { at: Date.now(), data })
		return NextResponse.json({ ok: true, posts: data.posts.length })
	} catch (e) {
		return NextResponse.json({ error: (e as Error)?.message || 'parse' }, { status: 400 })
	}
}
