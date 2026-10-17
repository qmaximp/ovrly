// Единый слой хранения ссылок, инвайтов и настроек.
//
// DATABASE_URL задан  -> PostgreSQL
// DATABASE_URL пустой -> JSON-файлы в data/ (локальная разработка)
//
// Функции намеренно асинхронные: у JSON-адаптера они сразу возвращают результат,
// у Postgres — ждут запрос. server.js использует этот же модуль через require.
const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.DATA_DIR
	? path.resolve(process.env.DATA_DIR)
	: path.join(process.cwd(), 'data')
const LINKS_FILE = path.join(DATA_DIR, 'links.json')
const INVITES_FILE = path.join(DATA_DIR, 'invites.json')
const OWNER_FILE = path.join(DATA_DIR, 'owner.json')

function hasDatabase() {
	return !!process.env.DATABASE_URL
}

function readJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch {
		return fallback
	}
}

function writeJsonAtomic(file, data) {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	const text = JSON.stringify(data, null, 2)
	const tmp = `${file}.${process.pid}.tmp`
	try {
		fs.writeFileSync(tmp, text)
		fs.renameSync(tmp, file)
	} catch {
		fs.writeFileSync(file, text)
		try {
			fs.unlinkSync(tmp)
		} catch {}
	}
}

function readLinksFile() {
	return readJson(LINKS_FILE, {})
}

function writeLinksFile(data) {
	writeJsonAtomic(LINKS_FILE, data)
}

function readInvitesFile() {
	return readJson(INVITES_FILE, {})
}

function writeInvitesFile(data) {
	writeJsonAtomic(INVITES_FILE, data)
}

function entryFromJson(entry) {
	return {
		status: entry.status === 'accepted' ? 'accepted' : 'pending',
		suspended: !!entry.suspended,
		invitedAt: entry.invitedAt || new Date().toISOString(),
		...(entry.visitedAt ? { visitedAt: entry.visitedAt } : {}),
		...(entry.acceptedAt ? { acceptedAt: entry.acceptedAt } : {}),
	}
}

function linkFromJson(login, rec) {
	return {
		login,
		token: rec.token,
		updatedAt: rec.updatedAt,
		...(rec.userToken ? { userToken: rec.userToken } : {}),
		...(rec.userTokenExpires ? { userTokenExpires: rec.userTokenExpires } : {}),
		...(rec.refreshToken ? { refreshToken: rec.refreshToken } : {}),
	}
}

function jsonGetLinks() {
	const data = readLinksFile()
	return Object.entries(data)
		.filter(([, rec]) => rec && rec.token)
		.map(([login, rec]) => linkFromJson(login, rec))
}

function jsonSaveLinks(data) {
	writeLinksFile(data)
}

function jsonGetLink(login) {
	const rec = readLinksFile()[login]
	return rec ? linkFromJson(login, rec) : null
}

function jsonUpsertLink(login, partial) {
	const data = readLinksFile()
	const prev = data[login] || {}
	const next = {
		...prev,
		...partial,
		token: partial.token ?? prev.token,
		updatedAt: partial.updatedAt ?? prev.updatedAt ?? new Date().toISOString(),
	}
	if (!next.token) throw new Error('token is required for a link')
	data[login] = next
	writeLinksFile(data)
	return linkFromJson(login, next)
}

function jsonFindOwnerByToken(token) {
	const data = readLinksFile()
	for (const [login, rec] of Object.entries(data)) {
		if (rec && rec.token === token) return login
	}
	return null
}

function jsonGetOwner() {
	const data = readJson(OWNER_FILE, null)
	return data && typeof data.login === 'string' ? data.login : null
}

function jsonSetOwner(login) {
	writeJsonAtomic(OWNER_FILE, { login, setAt: new Date().toISOString() })
}

function jsonGetAllInvites() {
	const data = readInvitesFile()
	const out = []
	for (const [owner, rec] of Object.entries(data)) {
		for (const [moderator, entry] of Object.entries(rec?.moderators ?? {})) {
			if (!entry) continue
			out.push({ owner, moderator, ...entryFromJson(entry) })
		}
	}
	return out
}

function jsonGetInvite(owner, moderator) {
	const entry = readInvitesFile()[owner]?.moderators?.[moderator]
	return entry ? entryFromJson(entry) : null
}

function jsonUpsertInvite(owner, moderator, entry) {
	const data = readInvitesFile()
	data[owner] = data[owner] || { moderators: {} }
	data[owner].moderators = data[owner].moderators || {}
	data[owner].moderators[moderator] = entry
	writeInvitesFile(data)
}

function jsonRemoveInvite(owner, moderator) {
	const data = readInvitesFile()
	if (data[owner]?.moderators?.[moderator]) {
		delete data[owner].moderators[moderator]
		writeInvitesFile(data)
	}
}

function jsonListModerators(owner) {
	return jsonGetAllInvites()
		.filter(row => row.owner === owner)
		.map(({ owner: _owner, moderator, ...entry }) => ({
			login: moderator,
			...entry,
		}))
		.sort((a, b) => (a.invitedAt < b.invitedAt ? 1 : -1))
}

function jsonListInvitesFor(login) {
	return jsonGetAllInvites()
		.filter(row => row.moderator === login)
		.map(row => ({
			owner: row.owner,
			entry: {
				status: row.status,
				suspended: row.suspended,
				invitedAt: row.invitedAt,
				...(row.visitedAt ? { visitedAt: row.visitedAt } : {}),
				...(row.acceptedAt ? { acceptedAt: row.acceptedAt } : {}),
			},
		}))
		.sort((a, b) => (a.entry.invitedAt < b.entry.invitedAt ? 1 : -1))
}

// --- PostgreSQL ---

let sql = null

function db() {
	if (!hasDatabase()) return null
	if (!sql) {
		const postgres = require('postgres')
		sql = postgres(process.env.DATABASE_URL, {
			max: 10,
			idle_timeout: 20,
			onnotice: () => {},
		})
	}
	return sql
}

function iso(value) {
	if (!value) return undefined
	if (value instanceof Date) return value.toISOString()
	return String(value)
}

function dbLink(row) {
	return {
		login: row.login,
		token: row.token,
		updatedAt: iso(row.updated_at),
		...(row.user_token ? { userToken: row.user_token } : {}),
		...(row.user_token_expires != null
			? { userTokenExpires: Number(row.user_token_expires) }
			: {}),
		...(row.refresh_token ? { refreshToken: row.refresh_token } : {}),
	}
}

function dbInvite(row) {
	return {
		status: row.status === 'accepted' ? 'accepted' : 'pending',
		suspended: !!row.suspended,
		invitedAt: iso(row.invited_at),
		...(row.visited_at ? { visitedAt: iso(row.visited_at) } : {}),
		...(row.accepted_at ? { acceptedAt: iso(row.accepted_at) } : {}),
	}
}

async function dbGetLinks() {
	const rows = await db()`
		SELECT login, token, updated_at, user_token, user_token_expires, refresh_token
		FROM links
		ORDER BY login
	`
	return rows.map(dbLink)
}

async function dbSaveLinks(data) {
	const client = db()
	await client.begin(async tx => {
		for (const [login, rec] of Object.entries(data)) {
			if (!rec || !rec.token) continue
			await tx`
				INSERT INTO links (login, token, updated_at, user_token, user_token_expires, refresh_token)
				VALUES (${login}, ${rec.token}, ${new Date(rec.updatedAt || Date.now())}, ${rec.userToken ?? null}, ${rec.userTokenExpires ?? null}, ${rec.refreshToken ?? null})
				ON CONFLICT (login) DO UPDATE SET
					token = EXCLUDED.token,
					updated_at = EXCLUDED.updated_at,
					user_token = EXCLUDED.user_token,
					user_token_expires = EXCLUDED.user_token_expires,
					refresh_token = EXCLUDED.refresh_token
			`
		}
	})
}

async function dbGetLink(login) {
	const rows = await db()`
		SELECT login, token, updated_at, user_token, user_token_expires, refresh_token
		FROM links
		WHERE login = ${login}
		LIMIT 1
	`
	return rows[0] ? dbLink(rows[0]) : null
}

async function dbUpsertLink(login, partial) {
	const prev = await dbGetLink(login)
	const next = {
		login,
		token: partial.token ?? prev?.token,
		updatedAt: partial.updatedAt ?? prev?.updatedAt ?? new Date().toISOString(),
		userToken: partial.userToken ?? prev?.userToken,
		userTokenExpires: partial.userTokenExpires ?? prev?.userTokenExpires,
		refreshToken: partial.refreshToken ?? prev?.refreshToken,
	}
	if (!next.token) throw new Error('token is required for a link')
	await db()`
		INSERT INTO links (login, token, updated_at, user_token, user_token_expires, refresh_token)
		VALUES (${login}, ${next.token}, ${new Date(next.updatedAt)}, ${next.userToken ?? null}, ${next.userTokenExpires ?? null}, ${next.refreshToken ?? null})
		ON CONFLICT (login) DO UPDATE SET
			token = EXCLUDED.token,
			updated_at = EXCLUDED.updated_at,
			user_token = EXCLUDED.user_token,
			user_token_expires = EXCLUDED.user_token_expires,
			refresh_token = EXCLUDED.refresh_token
	`
	return dbLink({
		login,
		token: next.token,
		updated_at: next.updatedAt,
		user_token: next.userToken,
		user_token_expires: next.userTokenExpires,
		refresh_token: next.refreshToken,
	})
}

async function dbFindOwnerByToken(token) {
	const rows = await db()`
		SELECT login FROM links WHERE token = ${token} LIMIT 1
	`
	return rows[0]?.login ?? null
}

async function dbGetOwner() {
	const rows = await db()`
		SELECT value FROM settings WHERE key = 'owner' LIMIT 1
	`
	const login = rows[0]?.value?.login
	return typeof login === 'string' ? login : null
}

async function dbSetOwner(login) {
	await db()`
		INSERT INTO settings (key, value, updated_at)
		VALUES ('owner', ${JSON.stringify({ login, setAt: new Date().toISOString() })}::jsonb, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`
}

async function dbGetAllInvites() {
	const rows = await db()`
		SELECT owner, moderator, status, suspended, invited_at, visited_at, accepted_at
		FROM invites
		ORDER BY invited_at DESC
	`
	return rows.map(row => ({
		owner: row.owner,
		moderator: row.moderator,
		...dbInvite(row),
	}))
}

async function dbGetInvite(owner, moderator) {
	const rows = await db()`
		SELECT owner, moderator, status, suspended, invited_at, visited_at, accepted_at
		FROM invites
		WHERE owner = ${owner} AND moderator = ${moderator}
		LIMIT 1
	`
	return rows[0] ? dbInvite(rows[0]) : null
}

async function dbUpsertInvite(owner, moderator, entry) {
	await db()`
		INSERT INTO invites (owner, moderator, status, suspended, invited_at, visited_at, accepted_at)
		VALUES (${owner}, ${moderator}, ${entry.status}, ${!!entry.suspended}, ${new Date(entry.invitedAt)}, ${entry.visitedAt ? new Date(entry.visitedAt) : null}, ${entry.acceptedAt ? new Date(entry.acceptedAt) : null})
		ON CONFLICT (owner, moderator) DO UPDATE SET
			status = EXCLUDED.status,
			suspended = EXCLUDED.suspended,
			invited_at = EXCLUDED.invited_at,
			visited_at = EXCLUDED.visited_at,
			accepted_at = EXCLUDED.accepted_at
	`
}

async function dbRemoveInvite(owner, moderator) {
	await db()`
		DELETE FROM invites WHERE owner = ${owner} AND moderator = ${moderator}
	`
}

async function dbListModerators(owner) {
	const rows = await db()`
		SELECT owner, moderator, status, suspended, invited_at, visited_at, accepted_at
		FROM invites
		WHERE owner = ${owner}
		ORDER BY invited_at DESC
	`
	return rows.map(row => ({ login: row.moderator, ...dbInvite(row) }))
}

async function dbListInvitesFor(login) {
	const rows = await db()`
		SELECT owner, moderator, status, suspended, invited_at, visited_at, accepted_at
		FROM invites
		WHERE moderator = ${login}
		ORDER BY invited_at DESC
	`
	return rows.map(row => ({ owner: row.owner, entry: dbInvite(row) }))
}

// --- public API ---

async function getLinks() {
	return hasDatabase() ? dbGetLinks() : jsonGetLinks()
}

async function saveLinks(data) {
	if (hasDatabase()) await dbSaveLinks(data)
	else jsonSaveLinks(data)
}

async function getLink(login) {
	return hasDatabase() ? dbGetLink(login) : jsonGetLink(login)
}

async function upsertLink(login, partial) {
	return hasDatabase()
		? dbUpsertLink(login, partial)
		: jsonUpsertLink(login, partial)
}

async function findOwnerByToken(token) {
	return hasDatabase() ? dbFindOwnerByToken(token) : jsonFindOwnerByToken(token)
}

async function getOwner() {
	return hasDatabase() ? dbGetOwner() : jsonGetOwner()
}

async function setOwner(login) {
	if (hasDatabase()) await dbSetOwner(login)
	else jsonSetOwner(login)
}

async function getAllInvites() {
	return hasDatabase() ? dbGetAllInvites() : jsonGetAllInvites()
}

async function getInvite(owner, moderator) {
	return hasDatabase()
		? dbGetInvite(owner, moderator)
		: jsonGetInvite(owner, moderator)
}

async function upsertInvite(owner, moderator, entry) {
	if (hasDatabase()) await dbUpsertInvite(owner, moderator, entry)
	else jsonUpsertInvite(owner, moderator, entry)
}

async function removeInvite(owner, moderator) {
	if (hasDatabase()) await dbRemoveInvite(owner, moderator)
	else jsonRemoveInvite(owner, moderator)
}

async function listModerators(owner) {
	return hasDatabase() ? dbListModerators(owner) : jsonListModerators(owner)
}

async function listInvitesFor(login) {
	return hasDatabase() ? dbListInvitesFor(login) : jsonListInvitesFor(login)
}

module.exports = {
	hasDatabase,
	getLinks,
	saveLinks,
	getLink,
	upsertLink,
	findOwnerByToken,
	getOwner,
	setOwner,
	getAllInvites,
	getInvite,
	upsertInvite,
	removeInvite,
	listModerators,
	listInvitesFor,
}
