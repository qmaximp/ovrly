import { adminFrom, json } from '@/lib/api'
import {
	addStreamer,
	listAdminStreamers,
	removeAllStreamers,
	removeStreamer,
	setThreshold,
	syncAllStreamers,
	updateStreamer,
} from '@/lib/streamers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
		if (body?.action === 'remove-all') {
			return json(await removeAllStreamers())
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
