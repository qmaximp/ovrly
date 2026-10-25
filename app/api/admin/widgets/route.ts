import postgres from 'postgres'
import { isAdminLogin } from '@/lib/admin'
import { verifySession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})

function sessionFrom(req: Request) {
	const raw = req.headers
		.get('cookie')
		?.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1]
	if (!raw) return null
	let value = raw
	try {
		value = decodeURIComponent(raw)
	} catch {}
	return verifySession(value)
}

function adminFrom(req: Request) {
	const session = sessionFrom(req)
	return session && isAdminLogin(session.login) ? session : null
}

function db() {
	const url = process.env.DATABASE_URL
	if (!url) return null
	const g = globalThis as any
	if (!g.__ovrlyWidgetLibraryDb) {
		g.__ovrlyWidgetLibraryDb = postgres(url, {
			max: 2,
			onnotice: () => {},
		})
	}
	return g.__ovrlyWidgetLibraryDb as ReturnType<typeof postgres>
}

export async function GET(req: Request) {
	if (!adminFrom(req)) return json({ error: 'forbidden' }, 403)
	const sql = db()
	if (!sql) return json({ error: 'database is not configured' }, 501)
	try {
		const rows = await sql`
			SELECT id, owner, name, definition, updated_at
			FROM widget_library
			ORDER BY updated_at DESC
			LIMIT 500
		`
		return json({
			widgets: rows.map(r => ({
				id: r.id,
				owner: r.owner,
				name: r.name,
				definition: r.definition,
				updatedAt: r.updated_at,
			})),
		})
	} catch (e) {
		console.error('[admin/widgets] list failed:', (e as Error).message)
		return json({ error: 'cannot load widgets' }, 500)
	}
}

export async function DELETE(req: Request) {
	if (!adminFrom(req)) return json({ error: 'forbidden' }, 403)
	const sql = db()
	if (!sql) return json({ error: 'database is not configured' }, 501)
	const id = new URL(req.url).searchParams.get('id')
	if (!id) return json({ error: 'bad id' }, 400)
	try {
		const rows = await sql`
			DELETE FROM widget_library WHERE id = ${id} RETURNING id
		`
		if (!rows.length) return json({ error: 'not found' }, 404)
		return json({ ok: true })
	} catch (e) {
		console.error('[admin/widgets] delete failed:', (e as Error).message)
		return json({ error: 'cannot delete widget' }, 500)
	}
}
