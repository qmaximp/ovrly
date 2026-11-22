import { adminFrom, json } from '@/lib/api'
import { listUsers } from '@/lib/users'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Только для админа: список аккаунтов без хэшей паролей.
export async function GET(req: Request) {
	if (!adminFrom(req)) return json({ error: 'forbidden' }, 403)
	const url = new URL(req.url)
	const limit = Number(url.searchParams.get('limit') || 1000)
	try {
		return json({ users: await listUsers(limit) })
	} catch (e) {
		// Не отдаём пустой 500: клиент ждёт JSON и иначе падает на res.json().
		console.error('[admin/users]', e)
		return json({ error: 'Не удалось загрузить аккаунты' }, 500)
	}
}
