import { NextResponse } from 'next/server'
import { importBotEntries } from '@/lib/changelog'
import { entryFromUpdate, webhookSecret } from '@/lib/telegramBot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Приём апдейтов Telegram (webhook). Нужен потому, что с этого хостинга
// исходящие к api.telegram.org закрыты: Telegram сам стучится к нам, а мы
// только читаем тело запроса. Секрет сверяем по заголовку, который Telegram
// присылает ровно в том виде, в каком его задали при setWebhook.
export async function POST(req: Request) {
	const secret = webhookSecret()
	if (secret.length < 10) {
		return NextResponse.json(
			{ ok: false, error: 'webhook не настроен' },
			{ status: 503 },
		)
	}
	const got = req.headers.get('x-telegram-bot-api-secret-token') || ''
	if (got !== secret) {
		return NextResponse.json({ ok: false }, { status: 403 })
	}
	let body: unknown = null
	try {
		body = await req.json()
	} catch {
		// пустое/битое тело: Telegram всё равно ждёт 2xx, иначе будет ретраить
		return NextResponse.json({ ok: true })
	}
	try {
		const entry = await entryFromUpdate(body)
		if (entry) await importBotEntries([entry])
	} catch (e) {
		console.error('[telegram/hook]', (e as Error)?.message || e)
		// 200, чтобы Telegram не зациклил повторы на нашей ошибке хранения
	}
	return NextResponse.json({ ok: true })
}

export async function GET() {
	// быстрый health-check без секрета: только факт настройки
	return NextResponse.json({ configured: webhookSecret().length >= 10 })
}
