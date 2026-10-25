import postgres from 'postgres'
import { verifySession } from '@/lib/session'
import { fromPortableWidget } from '@/lib/widgets'

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

// Один клиент на процесс: Next dev/HMR не должен плодить пулы соединений
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

function cleanPublicDefinition(raw: unknown) {
	const def = fromPortableWidget(raw)
	if (!def) return null
	const total =
		def.header.length + def.body.length + def.style.length + def.script.length
	if (total > 240 * 1024) return null
	if (def.name.length > 80) def.name = def.name.slice(0, 80)
	return def
}

export async function GET(req: Request) {
	const session = sessionFrom(req)
	if (!session) return json({ error: 'unauthorized' }, 401)
	const sql = db()
	if (!sql) return json({ error: 'database is not configured' }, 501)
	try {
		const rows = await sql`
			SELECT id, owner, name, definition, updated_at
			FROM widget_library
			ORDER BY updated_at DESC
			LIMIT 100
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
		console.error('[widget-library] list failed:', (e as Error).message)
		return json({ error: 'cannot load library' }, 500)
	}
}

export async function POST(req: Request) {
	const session = sessionFrom(req)
	if (!session) return json({ error: 'unauthorized' }, 401)
	const sql = db()
	if (!sql) return json({ error: 'database is not configured' }, 501)
	let body: {
		action?: string
		definition?: unknown
		id?: string
	}
	try {
		body = await req.json()
	} catch {
		return json({ error: 'bad json' }, 400)
	}
	const owner = session.login.toLowerCase()

	if (body.action === 'publish') {
		const def = cleanPublicDefinition(body.definition)
		if (!def) return json({ error: 'invalid widget' }, 400)
		const recId = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		try {
			const rows = await sql`
				INSERT INTO widget_library (id, owner, source_id, name, definition)
				VALUES (${recId}, ${owner}, ${def.id}, ${def.name}, ${sql.json(def)})
				ON CONFLICT (owner, source_id) DO UPDATE SET
					name = EXCLUDED.name,
					definition = EXCLUDED.definition,
					updated_at = now()
				RETURNING id
			`
			return json({ ok: true, id: rows[0]?.id ?? recId })
		} catch (e) {
			console.error('[widget-library] publish failed:', (e as Error).message)
			return json({ error: 'cannot publish' }, 500)
		}
	}

	if (body.action === 'unpublish') {
		if (typeof body.id !== 'string') return json({ error: 'bad id' }, 400)
		try {
			await sql`
				DELETE FROM widget_library
				WHERE id = ${body.id} AND owner = ${owner}
			`
			return json({ ok: true })
		} catch (e) {
			console.error('[widget-library] unpublish failed:', (e as Error).message)
			return json({ error: 'cannot unpublish' }, 500)
		}
	}

	return json({ error: 'unknown action' }, 400)
}
