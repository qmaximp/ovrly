import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { SECRET } from './session'

// Одноразовые коды подтверждения почты.
//
// Код никогда не хранится в открытом виде: в базе/файле лежит HMAC(email + код).
// Живёт 10 минут, максимум 5 попыток ввода, повторная отправка — не чаще
// раза в минуту.

export const CODE_TTL_MS = 10 * 60 * 1000
export const CODE_MAX_ATTEMPTS = 5
export const CODE_RESEND_MS = 60 * 1000

// Коды регистрации и сброса пароля живут в разных «ячейках»: код, присланный
// для регистрации, нельзя предъявить при смене пароля.
export function resetKey(email: string): string {
	return `reset:${email.trim().toLowerCase()}`
}

type CodeRow = {
	codeHash: string
	expiresAt: number
	attempts: number
	sentAt: number
}

const DATA_DIR = process.env.DATA_DIR
	? path.resolve(process.env.DATA_DIR)
	: path.join(process.cwd(), 'data')
const CODES_FILE = path.join(DATA_DIR, 'email-codes.json')

function usePg(): boolean {
	return Boolean(process.env.DATABASE_URL)
}

function hashCode(email: string, code: string): string {
	return crypto
		.createHmac('sha256', SECRET)
		.update(`email-code:${email.toLowerCase()}:${code}`)
		.digest('hex')
}

// --- JSON ---

let chain: Promise<unknown> = Promise.resolve()

async function readJson(): Promise<Record<string, CodeRow>> {
	try {
		const raw = await fs.readFile(CODES_FILE, 'utf8')
		const parsed = JSON.parse(raw)
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

async function writeJson(rows: Record<string, CodeRow>): Promise<void> {
	await fs.mkdir(DATA_DIR, { recursive: true })
	const tmp = `${CODES_FILE}.${process.pid}.tmp`
	await fs.writeFile(tmp, JSON.stringify(rows), 'utf8')
	await fs.rename(tmp, CODES_FILE)
}

function withJson<T>(fn: (rows: Record<string, CodeRow>) => T | Promise<T>): Promise<T> {
	const run = async () => {
		const rows = await readJson()
		const result = await fn(rows)
		await writeJson(rows)
		return result
	}
	const next = chain.then(run, run)
	chain = next.catch(() => {})
	return next
}

// --- PostgreSQL ---

type Sql = import('postgres').Sql
let sql: Sql | null = null
let schemaReady: Promise<void> | null = null

async function db(): Promise<Sql> {
	if (!sql) {
		const { default: postgres } = await import('postgres')
		sql = postgres(process.env.DATABASE_URL!, {
			max: 3,
			idle_timeout: 20,
			connect_timeout: 10,
		})
	}
	if (!schemaReady) {
		schemaReady = (async () => {
			await sql!`
				CREATE TABLE IF NOT EXISTS email_codes (
					email text PRIMARY KEY,
					code_hash text NOT NULL,
					expires_at timestamptz NOT NULL,
					attempts integer NOT NULL DEFAULT 0,
					sent_at timestamptz NOT NULL DEFAULT now()
				)
			`
		})()
	}
	await schemaReady
	return sql
}

// --- API ---

export async function putCode(email: string, code: string): Promise<void> {
	const key = email.toLowerCase()
	const codeHash = hashCode(key, code)
	const expiresAt = Date.now() + CODE_TTL_MS
	if (usePg()) {
		const sql = await db()
		await sql`
			INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_at)
			VALUES (${key}, ${codeHash}, ${new Date(expiresAt)}, 0, now())
			ON CONFLICT (email) DO UPDATE
			SET code_hash = excluded.code_hash,
				expires_at = excluded.expires_at,
				attempts = 0,
				sent_at = now()
		`
		return
	}
	await withJson(rows => {
		rows[key] = { codeHash, expiresAt, attempts: 0, sentAt: Date.now() }
	})
}

export async function checkCode(
	email: string,
	code: string,
): Promise<'ok' | 'wrong' | 'expired' | 'missing' | 'too_many'> {
	const key = email.toLowerCase()
	if (usePg()) {
		const sql = await db()
		const rows = await sql<CodeRow[]>`
			SELECT code_hash AS "codeHash",
				EXTRACT(EPOCH FROM expires_at) * 1000 AS "expiresAt",
				attempts
			FROM email_codes WHERE email = ${key}
		`
		const row = rows[0]
		if (!row) return 'missing'
		if (row.attempts >= CODE_MAX_ATTEMPTS) return 'too_many'
		if (Number(row.expiresAt) < Date.now()) {
			await sql`DELETE FROM email_codes WHERE email = ${key}`
			return 'expired'
		}
		const given = Buffer.from(hashCode(key, code))
		const want = Buffer.from(row.codeHash)
		const match =
			given.length === want.length && crypto.timingSafeEqual(given, want)
		if (!match) {
			await sql`
				UPDATE email_codes SET attempts = attempts + 1 WHERE email = ${key}
			`
			return 'wrong'
		}
		return 'ok'
	}

	return withJson(rows => {
		const row = rows[key]
		if (!row) return 'missing'
		if (row.attempts >= CODE_MAX_ATTEMPTS) return 'too_many'
		if (row.expiresAt < Date.now()) {
			delete rows[key]
			return 'expired'
		}
		const given = Buffer.from(hashCode(key, code))
		const want = Buffer.from(row.codeHash)
		const match = given.length === want.length && crypto.timingSafeEqual(given, want)
		if (!match) {
			row.attempts += 1
			return 'wrong'
		}
		return 'ok'
	})
}

export async function recentSend(email: string): Promise<boolean> {
	const key = email.toLowerCase()
	if (usePg()) {
		const sql = await db()
		const rows = await sql<{ sentAt: number }[]>`
			SELECT EXTRACT(EPOCH FROM sent_at) * 1000 AS "sentAt"
			FROM email_codes WHERE email = ${key}
		`
		const sentAt = Number(rows[0]?.sentAt || 0)
		return Date.now() - sentAt < CODE_RESEND_MS
	}
	const rows = await readJson()
	const row = rows[key]
	return Boolean(row && Date.now() - row.sentAt < CODE_RESEND_MS)
}

export async function clearCode(email: string): Promise<void> {
	const key = email.toLowerCase()
	if (usePg()) {
		const sql = await db()
		await sql`DELETE FROM email_codes WHERE email = ${key}`
		return
	}
	await withJson(rows => {
		delete rows[key]
	})
}
