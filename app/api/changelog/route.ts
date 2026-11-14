import { json } from '@/lib/api'
import { loadChangelog } from '@/lib/changelog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const data = await loadChangelog()
	return json(data, 200, {
		'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
	})
}
