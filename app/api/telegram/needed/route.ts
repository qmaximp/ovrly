import { NextResponse } from 'next/server'
import postgres from 'postgres'
import { normalizeTelegramChannel } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
	const secret = process.env.TELEGRAM_WEBHOOK_SECRET || ''
	if (!secret) return NextResponse.json({ channels: [] })
	if (req.headers.get('x-ovrly-secret') !== secret)
		return NextResponse.json({ error: 'forbidden' }, { status: 403 })
	if (!process.env.DATABASE_URL) return NextResponse.json({ channels: [] })
	const sql = postgres(process.env.DATABASE_URL, { max: 1 })
	try {
		const rows = await sql<{ state: unknown }[]>`select state from rooms`
		const set = new Set<string>()
		for (const row of rows) {
			const state = row.state as { elements?: { type?: string; telegramChannel?: string }[] } | null
			for (const el of state?.elements || []) {
				if (el?.type !== 'telegram') continue
				const ch = normalizeTelegramChannel(el.telegramChannel || '')
				if (ch) set.add(ch)
			}
		}
		// Каналы, которые сейчас открывают в карточке (запрос «обнови поскорее»).
		const wanted = await sql<{ key: string; value: unknown }[]>`
			select key, value from settings where key like 'tgneed:%'
		`
		for (const row of wanted) {
			const at = Number(row.value) || 0
			if (!at || Date.now() - at > 60 * 60 * 1000) continue
			const ch = normalizeTelegramChannel(row.key.slice('tgneed:'.length))
			if (ch) set.add(ch)
		}
		return NextResponse.json({ channels: [...set] })
	} catch {
		return NextResponse.json({ channels: [] })
	} finally {
		await sql.end({ timeout: 1 }).catch(() => {})
	}
}
