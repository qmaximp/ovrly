import { NextResponse } from 'next/server'
import { clientIp, rateLimit } from '@/lib/api'
import { createCaptcha } from '@/lib/captcha'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Капча выдаётся картинкой-SVG и подписанным токеном. Ответ хранится только
// в токене (HMAC), поэтому серверу не нужно помнить сессии.
export async function GET(req: Request) {
	// грубый лимит: каждая картинка — работа CPU, не даём выкачивать миллионами
	const ip = clientIp(req)
	if (!rateLimit(`captcha:${ip}`, 30, 60_000)) {
		return NextResponse.json(
			{ error: 'Слишком много запросов' },
			{ status: 429, headers: { 'Cache-Control': 'no-store' } },
		)
	}

	const captcha = createCaptcha()
	return NextResponse.json(captcha, {
		headers: { 'Cache-Control': 'no-store, max-age=0' },
	})
}
