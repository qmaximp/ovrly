import {
	ensurePendingInvite,
	getInviteStatus,
	listModerators,
} from '@/lib/invites'
import { readLinks, writeLinks } from '@/lib/links'
import { verifySession } from '@/lib/session'
import { twitchUserId } from '@/lib/twitch'

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

async function refreshUserToken(login: string): Promise<string | null> {
	const links = await readLinks()
	const link = links[login]
	if (!link?.refreshToken) return null
	const res = await fetch('https://id.twitch.tv/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: process.env.TWITCH_CLIENT_ID || '',
			client_secret: process.env.TWITCH_CLIENT_SECRET || '',
			grant_type: 'refresh_token',
			refresh_token: link.refreshToken,
		}),
	})
	if (!res.ok) return null
	const data = await res.json()
	if (!data.access_token) return null
	link.userToken = data.access_token
	link.userTokenExpires = Date.now() + (data.expires_in ?? 14400) * 1000
	if (data.refresh_token) link.refreshToken = data.refresh_token
	links[login] = link
	await writeLinks(links)
	return data.access_token as string
}

export async function POST(req: Request) {
	const session = sessionFrom(req)
	if (!session) return json({ error: 'unauthorized' }, 401)

	const links = await readLinks()
	let token: string | null = links[session.login]?.userToken ?? null
	const expires = links[session.login]?.userTokenExpires ?? 0
	if (!token || expires < Date.now() + 60_000) {
		token = await refreshUserToken(session.login)
	}
	if (!token) return json({ error: 'reauth' }, 403)

	const broadcasterId = await twitchUserId(session.login)
	if (!broadcasterId) return json({ error: 'twitch user not found' }, 404)

	// список модераторов канала (нужен scope moderation:read)
	const res = await fetch(
		`https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${encodeURIComponent(
			broadcasterId,
		)}&first=100`,
		{
			headers: {
				'Client-Id': process.env.TWITCH_CLIENT_ID || '',
				Authorization: `Bearer ${token}`,
			},
		},
	)
	if (res.status === 401 || res.status === 403) {
		return json({ error: 'reauth' }, 403)
	}
	const data = await res.json().catch(() => null)
	if (!res.ok || !data) {
		return json({ error: 'twitch api error' }, 502)
	}

	const owner = session.login
	const existing = new Set(
		(await listModerators(owner)).map(m => String(m.login).toLowerCase()),
	)
	let imported = 0
	for (const mod of Array.isArray(data.data) ? data.data : []) {
		const login = String(mod.user_login || '').toLowerCase()
		if (!login || login === owner.toLowerCase() || existing.has(login)) continue
		const prev = await getInviteStatus(owner, login)
		if (prev) continue
		await ensurePendingInvite(owner, login)
		existing.add(login)
		imported += 1
	}

	return json({ imported, total: existing.size })
}
