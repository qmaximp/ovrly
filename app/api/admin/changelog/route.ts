import { isAdminLogin } from '@/lib/admin'
import { verifySession } from '@/lib/session'
import {
	addManualEntry,
	loadChangelog,
	removeManualEntry,
	setChangelogChannel,
} from '@/lib/changelog'
import { normalizeTelegramChannel } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})

function adminLogin(req: Request) {
	const raw = req.headers
		.get('cookie')
		?.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1]
	if (!raw) return null
	let value = raw
	try {
		value = decodeURIComponent(raw)
	} catch {}
	const session = verifySession(value)
	return session && isAdminLogin(session.login) ? session.login : null
}

export async function GET(req: Request) {
	if (!adminLogin(req)) return json({ error: 'forbidden' }, 403)
	const data = await loadChangelog()
	return json(data)
}

export async function POST(req: Request) {
	if (!adminLogin(req)) return json({ error: 'forbidden' }, 403)
	let body: {
		channel?: string
		add?: { text?: string; url?: string; date?: string }
		remove?: string
	} = {}
	try {
		body = await req.json()
	} catch {
		return json({ error: 'bad json' }, 400)
	}
	if (body.remove) {
		await removeManualEntry(String(body.remove))
		return json(await loadChangelog())
	}
	if (body.add) {
		try {
			await addManualEntry(body.add)
		} catch (e) {
			return json(
				{ error: (e as Error)?.message || 'Не удалось добавить запись' },
				400,
			)
		}
		return json(await loadChangelog())
	}
	const raw = String(body.channel || '').trim()
	if (!raw) {
		await setChangelogChannel('')
		return json(await loadChangelog())
	}
	const channel = normalizeTelegramChannel(raw)
	if (!channel) return json({ error: 'Укажите ссылку на Telegram-канал' }, 400)
	await setChangelogChannel(channel)
	// Сохраняем сразу: если t.me временно недоступен, ссылка не потеряется,
	// а админ увидит ошибку в списке.
	return json(await loadChangelog())
}
