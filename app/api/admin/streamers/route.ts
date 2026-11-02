import { isAdminLogin } from '@/lib/admin'
import { verifySession } from '@/lib/session'
import {
	addStreamer,
	listAdminStreamers,
	removeStreamer,
	setThreshold,
	syncAllStreamers,
	updateStreamer,
} from '@/lib/streamers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})

function adminFrom(req: Request) {
	const raw = req.headers
		.get('cookie')
		?.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1]
	if (!raw) return null
	let value = raw
	try {
		value = decodeURIComponent(raw)
	} catch {}
	const session = verifySession(value)
	return session && isAdminLogin(session.login) ? session : null
}

export async function GET(req: Request) {
	if (!adminFrom(req)) return json({ error: 'forbidden' }, 403)
	return json(await listAdminStreamers())
}

export async function POST(req: Request) {
	if (!adminFrom(req)) return json({ error: 'forbidden' }, 403)
	let body: any
	try {
		body = await req.json()
	} catch {
		return json({ error: 'bad json' }, 400)
	}

	try {
		if (body?.action === 'threshold') {
			return json(await setThreshold(Number(body.threshold)))
		}
		if (body?.action === 'update' && body.login) {
			return json(
				await updateStreamer(String(body.login), {
					...(typeof body.visible === 'boolean' ? { visible: body.visible } : {}),
					...(typeof body.featured === 'boolean'
						? { featured: body.featured }
						: {}),
					...(Number.isFinite(Number(body.followers))
						? { followers: Number(body.followers) }
						: {}),
				}),
			)
		}
		if (body?.action === 'sync') {
			await syncAllStreamers()
			return json(await listAdminStreamers())
		}
		if (body?.action === 'remove' && body.login) {
			return json(await removeStreamer(String(body.login)))
		}
		if (body?.action === 'add' && body.login) {
			const entry = await addStreamer(String(body.login))
			if (!entry) return json({ error: 'twitch user not found' }, 404)
			return json(await listAdminStreamers())
		}
	} catch (e) {
		return json({ error: (e as Error).message || 'failed' }, 500)
	}
	return json({ error: 'unknown action' }, 400)
}
