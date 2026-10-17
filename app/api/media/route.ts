import { mediaConfig, putBuffer } from '@/lib/mediaStore'
import { verifySession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})

function sessionFrom(req: Request) {
	return verifySession(
		req.headers.get('cookie')?.match(/(?:^|;\s*)sc_session=([^;]+)/)?.[1],
	)
}

// Клиенту нужно знать, включено ли R2: без него панель читает файл как
// data-URL, как раньше. Конфиг не секретный — только флаги и лимиты.
export async function GET() {
	const config = mediaConfig()
	return json(config ?? { enabled: false })
}

// Загрузка файла с ПК. Файл идёт одним запросом, сервер кладёт его в R2.
// В состояние комнаты вернётся только URL — база и память больше не растут.
export async function POST(req: Request) {
	const session = sessionFrom(req)
	if (!session) return json({ error: 'unauthorized' }, 401)

	const config = mediaConfig()
	if (!config) return json({ error: 'media storage is not configured' }, 501)

	const url = new URL(req.url)
	const name = url.searchParams.get('name') || ''
	const declared = req.headers.get('content-type') || url.searchParams.get('type') || ''
	const declaredLength = Number(req.headers.get('content-length') || 0)
	if (Number.isFinite(declaredLength) && declaredLength > config.maxBytes) {
		return json({ error: 'file too large', maxBytes: config.maxBytes }, 413)
	}

	let buffer: Buffer
	try {
		buffer = Buffer.from(await req.arrayBuffer())
	} catch {
		return json({ error: 'cannot read body' }, 400)
	}

	try {
		const media = await putBuffer(buffer, declared, name)
		return json(media, 201)
	} catch (e) {
		const error = e as { code?: string; limit?: number; message?: string }
		if (error.code === 'EMPTY') return json({ error: 'empty file' }, 400)
		if (error.code === 'UNSUPPORTED') {
			return json({ error: 'unsupported media type' }, 415)
		}
		if (error.code === 'TOO_LARGE') {
			return json(
				{ error: 'file too large', maxBytes: error.limit ?? config.maxBytes },
				413,
			)
		}
		console.error('[media] upload failed:', error.message)
		return json({ error: 'upload failed' }, 502)
	}
}
