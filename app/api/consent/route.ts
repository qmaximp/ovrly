import { appendFile, mkdir } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { sessionFrom } from '@/lib/api'
import { LEGAL_VERSION, consentCookieValue } from '@/lib/legal'
import { getOrigin, seeOther } from '@/lib/session'

// Согласие фиксируется на сервере до продолжения входа: cookie ставится
// HttpOnly, а факт согласия пишется в журнал (дата, IP, user-agent, версия).
// Для email-входа сессия уже создана, поэтому возвращаем в next; для Twitch
// сессии ещё нет — уходим в OAuth.

// простой лимит, чтобы публичная форма не забила диск журналом
const hits = new Map<string, number[]>()
const WINDOW = 60_000
const LIMIT = 10

export async function POST(req: Request) {
	const ip =
		(req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
		req.headers.get('x-real-ip') ||
		'unknown'
	const now = Date.now()
	const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW)
	if (recent.length >= LIMIT) {
		return new NextResponse('Слишком много попыток, повторите через минуту', {
			status: 429,
		})
	}
	recent.push(now)
	hits.set(ip, recent)

	const form = await req.formData()
	const nextRaw = String(form.get('next') || '/cabinet')
	const next =
		nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/cabinet'
	const terms = form.get('terms') === 'on'
	const pd = form.get('pd') === 'on'
	const session = sessionFrom(req)

	if (!terms || !pd) {
		// относительный Location: не зависит от подмены Host за прокси
		return seeOther(`/?consent=1&next=${encodeURIComponent(next)}`)
	}

	try {
		const dir = path.join(process.cwd(), 'data')
		await mkdir(dir, { recursive: true })
		await appendFile(
			path.join(dir, 'consents.jsonl'),
			JSON.stringify({
				event: 'consent',
				at: new Date().toISOString(),
				version: LEGAL_VERSION,
				terms: true,
				pd: true,
				...(session?.uid ? { uid: session.uid } : {}),
				login: session?.login || undefined,
				email: session?.email || undefined,
				ip,
				ua: (req.headers.get('user-agent') || '').slice(0, 300),
			}) + '\n',
			'utf8',
		)
	} catch {
		// журнал не должен ломать вход
	}

	const target = session
		? next
		: `/api/auth/twitch?next=${encodeURIComponent(next)}`
	const res = new NextResponse(null, {
		status: 303,
		headers: { Location: target },
	})
	res.cookies.set('sc_consent', consentCookieValue(session?.uid), {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 365,
		secure: getOrigin(req).startsWith('https:'),
	})
	return res
}
