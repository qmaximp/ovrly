import { NextResponse } from 'next/server'
import { loadChangelog } from '@/lib/changelog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
	const data = await loadChangelog()
	return NextResponse.json(data, {
		headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
	})
}
