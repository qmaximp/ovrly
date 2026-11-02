import { listPublicStreamers } from '@/lib/streamers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const { threshold, users } = await listPublicStreamers()
	return new Response(
		JSON.stringify({
			threshold,
			streamers: Object.values(users).map(u => ({
				login: u.login,
				displayName: u.displayName,
				avatar: u.avatar,
				followers: u.followers,
				featured: u.featured,
			})),
		}),
		{ headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
	)
}
