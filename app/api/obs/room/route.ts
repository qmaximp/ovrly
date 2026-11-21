import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { mint } from '@/lib/obsAccess'
import { readLinks } from '@/lib/links'
import { tokenForLogin, verifySession } from '@/lib/session'

// Ссылка на внешний док OBS (мост без открытой панели).
// Выдаётся только владельцу аккаунта: комната берётся из его же ссылки,
// произвольные комнаты создавать нельзя.
//
// Без rotate=true ключ не перевыпускается: повторный заход просто возвращает
// ту же ссылку. rotate=true — явная кнопка «перевыпустить» (старый ключ умрёт).
	const hits = new Map<string, number[]>()

function rateLimited(login: string) {
	const now = Date.now()
	const list = (hits.get(login) || []).filter(t => now - t < 60_000)
	list.push(now)
	hits.set(login, list)
	return list.length > 12
}

export async function POST(req: Request) {
	try {
		const jar = await cookies()
		const session = verifySession(jar.get('sc_session')?.value)
		if (!session) {
			return NextResponse.json({ error: 'нужен вход' }, { status: 401 })
		}
		if (!session.login) {
			return NextResponse.json(
				{ error: 'привяжите Twitch, чтобы получить ссылку для OBS' },
				{ status: 403 },
			)
		}
		if (rateLimited(session.login)) {
			return NextResponse.json({ error: 'слишком часто' }, { status: 429 })
		}
		const body = await req.json().catch(() => null)
		const links = await readLinks()
		const room = links[session.login]?.token || tokenForLogin(session.login)
		const res = await mint(room, body?.rotate === true)
		return NextResponse.json(res)
	} catch (e: any) {
		console.error('[obs/room] mint failed:', String(e?.message || e))
		return NextResponse.json({ error: 'не удалось создать ссылку' }, { status: 500 })
	}
}
