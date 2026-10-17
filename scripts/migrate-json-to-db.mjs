#!/usr/bin/env node
// Перенос данных из data/*.json в PostgreSQL.
//
// Запуск:
//   node --env-file=.env.local scripts/migrate-json-to-db.mjs --dry-run
//   node --env-file=.env.local scripts/migrate-json-to-db.mjs
//
// Скрипт идемпотентен: повторный запуск обновляет существующие записи.
// Приложение до переключения слоя хранения продолжает работать с JSON.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = process.env.DATA_DIR
	? path.resolve(process.env.DATA_DIR)
	: path.join(root, 'data')
const dryRun = process.argv.includes('--dry-run')

function readJson(file, fallback) {
	const full = path.join(dataDir, file)
	try {
		return JSON.parse(fs.readFileSync(full, 'utf8'))
	} catch (e) {
		if (e.code === 'ENOENT') return fallback
		throw new Error(`${file}: ${e.message}`)
	}
}

function dateOrNow(value) {
	if (!value) return new Date()
	const d = new Date(value)
	return Number.isNaN(d.getTime()) ? new Date() : d
}

function optionalDate(value) {
	if (!value) return null
	const d = new Date(value)
	return Number.isNaN(d.getTime()) ? null : d
}

const links = readJson('links.json', {})
const invites = readJson('invites.json', {})
const owner = readJson('owner.json', null)

const roomsDir = path.join(dataDir, 'rooms')
const roomFiles = fs.existsSync(roomsDir)
	? fs.readdirSync(roomsDir).filter(f => f.endsWith('.json'))
	: []

const rooms = []
for (const file of roomFiles) {
	try {
		const data = JSON.parse(fs.readFileSync(path.join(roomsDir, file), 'utf8'))
		if (!data || !data.state || !Array.isArray(data.state.elements)) continue
		const key =
			typeof data.key === 'string' && data.key
				? data.key
				: path.basename(file, '.json')
		const ownerLogin =
			Object.entries(links).find(([, rec]) => rec?.token === key)?.[0] ?? null
		rooms.push({
			key,
			owner: ownerLogin,
			state: data.state,
			savedAt: dateOrNow(data.savedAt),
		})
	} catch (e) {
		console.warn(`[skip] ${file}: ${e.message}`)
	}
}

const linkRows = Object.entries(links).filter(
	([, rec]) => rec && typeof rec.token === 'string' && rec.token,
)

const inviteRows = []
for (const [ownerLogin, rec] of Object.entries(invites)) {
	for (const [moderator, entry] of Object.entries(rec?.moderators ?? {})) {
		if (!entry) continue
		inviteRows.push({
			owner: ownerLogin,
			moderator,
			status: entry.status === 'accepted' ? 'accepted' : 'pending',
			suspended: !!entry.suspended,
			invitedAt: dateOrNow(entry.invitedAt),
			visitedAt: optionalDate(entry.visitedAt),
			acceptedAt: optionalDate(entry.acceptedAt),
		})
	}
}

const counts = {
	links: linkRows.length,
	invites: inviteRows.length,
	rooms: rooms.length,
	owner: owner?.login ? 1 : 0,
}
console.log('JSON:', JSON.stringify(counts))

if (dryRun) {
	console.log('dry-run: база не изменялась')
	process.exit(0)
}

const url = process.env.DATABASE_URL
if (!url) {
	console.error(
		'DATABASE_URL не задан. Запусти: node --env-file=.env.local scripts/migrate-json-to-db.mjs',
	)
	process.exit(1)
}

const sql = postgres(url, { max: 2, onnotice: () => {} })
const schema = fs.readFileSync(path.join(root, 'db', 'schema.sql'), 'utf8')
const statements = schema
	.split(/;\s*(?:\n|$)/)
	.map(statement => statement.trim())
	.filter(Boolean)

try {
	await sql.begin(async tx => {
		for (const statement of statements) await tx.unsafe(statement)

		for (const [login, rec] of linkRows) {
			await tx`
				INSERT INTO links (login, token, updated_at, user_token, user_token_expires, refresh_token)
				VALUES (${login}, ${rec.token}, ${dateOrNow(rec.updatedAt)}, ${rec.userToken ?? null}, ${rec.userTokenExpires ?? null}, ${rec.refreshToken ?? null})
				ON CONFLICT (login) DO UPDATE SET
					token = EXCLUDED.token,
					updated_at = EXCLUDED.updated_at,
					user_token = EXCLUDED.user_token,
					user_token_expires = EXCLUDED.user_token_expires,
					refresh_token = EXCLUDED.refresh_token
			`
		}

		for (const row of inviteRows) {
			await tx`
				INSERT INTO invites (owner, moderator, status, suspended, invited_at, visited_at, accepted_at)
				VALUES (${row.owner}, ${row.moderator}, ${row.status}, ${row.suspended}, ${row.invitedAt}, ${row.visitedAt}, ${row.acceptedAt})
				ON CONFLICT (owner, moderator) DO UPDATE SET
					status = EXCLUDED.status,
					suspended = EXCLUDED.suspended,
					invited_at = EXCLUDED.invited_at,
					visited_at = EXCLUDED.visited_at,
					accepted_at = EXCLUDED.accepted_at
			`
		}

		for (const room of rooms) {
			await tx`
				INSERT INTO rooms (key, owner, state, updated_at)
				VALUES (${room.key}, ${room.owner}, ${JSON.stringify(room.state)}::jsonb, ${room.savedAt})
				ON CONFLICT (key) DO UPDATE SET
					owner = EXCLUDED.owner,
					state = EXCLUDED.state,
					updated_at = EXCLUDED.updated_at
			`
		}

		if (owner?.login) {
			await tx`
				INSERT INTO settings (key, value, updated_at)
				VALUES ('owner', ${JSON.stringify(owner)}::jsonb, now())
				ON CONFLICT (key) DO UPDATE SET
					value = EXCLUDED.value,
					updated_at = now()
			`
		}
	})
	console.log('Готово: данные перенесены в PostgreSQL.')
} catch (e) {
	console.error('Ошибка миграции:', e.message)
	process.exitCode = 1
} finally {
	await sql.end({ timeout: 5 })
}
