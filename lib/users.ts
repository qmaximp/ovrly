import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

// Учётные записи Ovrly.
//
// Раньше вход был только через Twitch и «аккаунтом» фактически был логин Twitch.
// Теперь есть почтовые аккаунты: у пользователя может быть email + пароль,
// а Twitch привязывается позже из кабинета. Записи храним в Postgres, если
// задан DATABASE_URL, иначе — в data/users.json (локальная разработка).

export type User = {
	id: string
	email: string | null
	passwordHash: string | null
	twitchLogin: string | null
	displayName: string
	avatar: string | null
	createdAt: string
	lastLoginAt: string | null
}

export type CreateUserInput = {
	email?: string | null
	passwordHash?: string | null
	twitchLogin?: string | null
	displayName: string
	avatar?: string | null
	lastLoginAt?: string | null
}

const DATA_DIR = process.env.DATA_DIR
	? path.resolve(process.env.DATA_DIR)
	: path.join(process.cwd(), 'data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeLogin(value: string): string {
	return value.trim().toLowerCase()
}

// --- JSON (локальная разработка) ---

let queue: Promise<unknown> = Promise.resolve()

// Все операции с файлом идут строго по очереди: иначе два одновременных
// запроса прочитают один и тот же массив и один из них потеряет запись.
function withJson<T>(fn: (rows: User[]) => Promise<T> | T): Promise<T> {
	const run = async () => {
		let rows: User[] = []
		try {
			const raw = await fs.readFile(USERS_FILE, 'utf8')
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed)) rows = parsed.filter(isUser)
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
		}
		const result = await fn(rows)
		await fs.mkdir(DATA_DIR, { recursive: true })
		// пишем через временный файл: обрыв посреди записи не оставит битый JSON
		const tmp = `${USERS_FILE}.${process.pid}.tmp`
		await fs.writeFile(tmp, JSON.stringify(rows, null, 2), 'utf8')
		await fs.rename(tmp, USERS_FILE)
		return result
	}
	const next = queue.then(run, run)
	queue = next.catch(() => undefined)
	return next
}

function isUser(value: unknown): value is User {
	const u = value as User
	return !!u && typeof u.id === 'string' && typeof u.displayName === 'string'
}

// --- PostgreSQL ---

let sql: import('postgres').Sql | null = null
let schemaReady: Promise<unknown> | null = null

async function db() {
	if (!sql) {
		const { default: postgres } = await import('postgres')
		sql = postgres(process.env.DATABASE_URL as string, {
			max: 5,
			idle_timeout: 20,
			connect_timeout: 10,
		})
	}
	if (!schemaReady) {
		schemaReady = (async () => {
			await sql!`
				CREATE TABLE IF NOT EXISTS users (
					id uuid PRIMARY KEY,
					email text UNIQUE,
					password_hash text,
					twitch_login text UNIQUE,
					display_name text NOT NULL,
					avatar text,
					created_at timestamptz NOT NULL DEFAULT now(),
					last_login_at timestamptz
				)
			`
			await sql!`
				CREATE UNIQUE INDEX IF NOT EXISTS users_twitch_lower_idx
				ON users (lower(twitch_login))
			`
			// Важно вернуть сам sql, а не undefined: минификатор Turbopack
			// иногда превращает `await schemaReady; return sql` в возврат
			// промиса schemaReady. Если промис резолвится в sql, оба варианта
			// работают одинаково.
			return sql!
		})()
	}
	await schemaReady
	return sql!
}

function fromRow(row: Record<string, unknown>): User {
	return {
		id: String(row.id),
		email: row.email == null ? null : String(row.email),
		passwordHash: row.password_hash == null ? null : String(row.password_hash),
		twitchLogin: row.twitch_login == null ? null : String(row.twitch_login),
		displayName: String(row.display_name || ''),
		avatar: row.avatar == null ? null : String(row.avatar),
		createdAt: new Date(row.created_at as string).toISOString(),
		lastLoginAt: row.last_login_at
			? new Date(row.last_login_at as string).toISOString()
			: null,
	}
}

const hasDb = () => !!process.env.DATABASE_URL

// --- Публичное API ---

export async function findUserByEmail(email: string): Promise<User | null> {
	const value = normalizeEmail(email)
	if (!value) return null
	if (hasDb()) {
		const rows = await (await db())`
			SELECT * FROM users WHERE lower(email) = ${value} LIMIT 1
		`
		return rows[0] ? fromRow(rows[0]) : null
	}
	return withJson(rows => {
		const found = rows.find(u => u.email?.toLowerCase() === value)
		return found ?? null
	})
}

export async function findUserByTwitch(login: string): Promise<User | null> {
	const value = normalizeLogin(login)
	if (!value) return null
	if (hasDb()) {
		const rows = await (await db())`
			SELECT * FROM users WHERE lower(twitch_login) = ${value} LIMIT 1
		`
		return rows[0] ? fromRow(rows[0]) : null
	}
	return withJson(rows => {
		const found = rows.find(u => u.twitchLogin?.toLowerCase() === value)
		return found ?? null
	})
}

export async function findUserById(id: string): Promise<User | null> {
	if (!id) return null
	if (hasDb()) {
		const rows = await (await db())`SELECT * FROM users WHERE id = ${id} LIMIT 1`
		return rows[0] ? fromRow(rows[0]) : null
	}
	return withJson(rows => rows.find(u => u.id === id) ?? null)
}

export class UserConflictError extends Error {
	constructor(public field: 'email' | 'twitch') {
		super(`${field} already used`)
		this.name = 'UserConflictError'
	}
}

export async function createUser(input: CreateUserInput): Promise<User> {
	const email = input.email ? normalizeEmail(input.email) : null
	const twitchLogin = input.twitchLogin ? normalizeLogin(input.twitchLogin) : null
	const user: User = {
		id: crypto.randomUUID(),
		email,
		passwordHash: input.passwordHash ?? null,
		twitchLogin,
		displayName: input.displayName.trim() || twitchLogin || email?.split('@')[0] || 'Зритель',
		avatar: input.avatar ?? null,
		createdAt: new Date().toISOString(),
		lastLoginAt: input.lastLoginAt ?? null,
	}

	if (hasDb()) {
		try {
			const rows = await (await db())`
				INSERT INTO users (id, email, password_hash, twitch_login, display_name, avatar)
				VALUES (${user.id}, ${user.email}, ${user.passwordHash}, ${user.twitchLogin},
					${user.displayName}, ${user.avatar})
				RETURNING *
			`
			return fromRow(rows[0])
		} catch (e) {
			const code = (e as { code?: string }).code
			// 23505 = unique_violation. Сообщаем, какое поле занято, не раскрывая
			// сами записи: по факту это гонка двух одновременных регистраций.
			if (code === '23505') {
				throw new UserConflictError(
					String((e as { constraint_name?: string }).constraint_name || '').includes(
						'twitch',
					)
						? 'twitch'
						: 'email',
				)
			}
			throw e
		}
	}

	return withJson(rows => {
		if (email && rows.some(u => u.email?.toLowerCase() === email)) {
			throw new UserConflictError('email')
		}
		if (twitchLogin && rows.some(u => u.twitchLogin?.toLowerCase() === twitchLogin)) {
			throw new UserConflictError('twitch')
		}
		rows.push(user)
		return user
	})
}

export async function updateUser(
	id: string,
	patch: Partial<Pick<User, 'email' | 'passwordHash' | 'twitchLogin' | 'displayName' | 'avatar' | 'lastLoginAt'>>,
): Promise<User | null> {
	if (hasDb()) {
		const columns: Record<string, unknown> = {}
		if (patch.email !== undefined) columns.email = patch.email
		if (patch.passwordHash !== undefined) columns.password_hash = patch.passwordHash
		if (patch.twitchLogin !== undefined) columns.twitch_login = patch.twitchLogin
		if (patch.displayName !== undefined) columns.display_name = patch.displayName
		if (patch.avatar !== undefined) columns.avatar = patch.avatar
		if (patch.lastLoginAt !== undefined) columns.last_login_at = patch.lastLoginAt
		const keys = Object.keys(columns)
		if (keys.length === 0) return findUserById(id)
		const connection = await db()
		// sql(obj, ...keys) собирает SET только из переданных колонок — значения
		// остаются параметрами запроса, поэтому инъекция через поля невозможна.
		const rows = await connection`
			UPDATE users SET ${connection(columns, ...keys)}
			WHERE id = ${id}
			RETURNING *
		`
		return rows[0] ? fromRow(rows[0]) : null
	}
	return withJson(rows => {
		const user = rows.find(u => u.id === id)
		if (!user) return null
		Object.assign(user, patch)
		return user
	})
}

export async function touchUserLogin(id: string): Promise<void> {
	await updateUser(id, { lastLoginAt: new Date().toISOString() })
}

// --- Для админки ---

// Публичное представление аккаунта: без хэша пароля и без соли.
export type PublicUser = {
	id: string
	email: string | null
	twitchLogin: string | null
	displayName: string
	avatar: string | null
	createdAt: string
	lastLoginAt: string | null
	hasPassword: boolean
}

function toPublic(user: User): PublicUser {
	return {
		id: user.id,
		email: user.email,
		twitchLogin: user.twitchLogin,
		displayName: user.displayName,
		avatar: user.avatar,
		createdAt: user.createdAt,
		lastLoginAt: user.lastLoginAt,
		hasPassword: !!user.passwordHash,
	}
}

// Все аккаунты, свежие сверху. Нужен админке: люди, зарегистрированные по
// почте, не попадают в список стримеров (тот строится по Twitch-логинам).
export async function listUsers(limit = 1000): Promise<PublicUser[]> {
	const cap = Math.min(Math.max(Math.floor(limit) || 1000, 1), 5000)
	if (hasDb()) {
		const rows = await (await db())`
			SELECT * FROM users ORDER BY created_at DESC LIMIT ${cap}
		`
		return rows.map(r => toPublic(fromRow(r)))
	}
	return withJson(rows => {
		const copy = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
		return copy.slice(0, cap).map(toPublic)
	})
}
