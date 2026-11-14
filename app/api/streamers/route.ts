import { json } from '@/lib/api'
import { listPublicStreamers } from '@/lib/streamers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const { threshold, users } = await listPublicStreamers()
	return json(
		{
			threshold,
			streamers: Object.values(users).map(u => ({
				login: u.login,
				displayName: u.displayName,
				avatar: u.avatar,
				followers: u.followers,
				featured: u.featured,
			})),
		},
		200,
		// список меняется раз в несколько минут — отдаём кэш CDN/браузера
		{ 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
	)
}
