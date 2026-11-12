// Доступ к OBS-мосту.
//
// В базе ключ хранится в двух видах:
//   key_hash — sha256 от ключа, по нему проверяем (сам ключ не нужен);
//   key_enc  — ключ, зашифрованный AES-256-GCM секретом сайта, чтобы владелец
//              мог перечитать свою ссылку, не перевыпуская её.
// Утечка дампа без секрета приложения не даёт доступа к OBS.
const crypto = require('crypto')

let sql = null
let ready = null
const mem = new Map() // room -> { hash, enc } (режим без БД)

function db() {
	if (!process.env.DATABASE_URL) return null
	if (!sql) {
		const postgres = require('postgres')
		sql = postgres(process.env.DATABASE_URL, {
			max: 2,
			idle_timeout: 20,
			onnotice: () => {},
		})
		ready = migrate(sql).catch(e => {
			console.error('[obs] миграция obs_access:', e.message)
		})
	}
	return sql
}

async function migrate(s) {
	await s`
		CREATE TABLE IF NOT EXISTS obs_access (
			room text PRIMARY KEY,
			key_hash text,
			key_enc text,
			created_at timestamptz NOT NULL DEFAULT now()
		)
	`
	// старая схема хранила сам ключ в колонке key — переносим в хеш и убираем
	await s`ALTER TABLE obs_access ADD COLUMN IF NOT EXISTS key_hash text`
	await s`ALTER TABLE obs_access ADD COLUMN IF NOT EXISTS key_enc text`
	await s`ALTER TABLE obs_access ALTER COLUMN key DROP NOT NULL`.catch(() => {})
	await s`
		UPDATE obs_access
		SET key_hash = encode(sha256(convert_to(key, 'UTF8')), 'hex')
		WHERE key_hash IS NULL AND key IS NOT NULL
	`.catch(() => {})
	await s`ALTER TABLE obs_access DROP COLUMN IF EXISTS key`
	await s`ALTER TABLE obs_access ALTER COLUMN key_hash SET NOT NULL`.catch(() => {})
	await s`CREATE UNIQUE INDEX IF NOT EXISTS obs_access_hash_idx ON obs_access (key_hash)`
}

function secret() {
	return (
		process.env.OBS_KEY_SECRET ||
		process.env.SESSION_SECRET ||
		process.env.TWITCH_CLIENT_SECRET ||
		''
	)
}

function hash(key) {
	return crypto.createHash('sha256').update(String(key)).digest('hex')
}

function same(a, b) {
	const x = Buffer.from(String(a))
	const y = Buffer.from(String(b))
	return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function encrypt(key) {
	const s = secret()
	if (!s) return null
	const iv = crypto.randomBytes(12)
	const k = crypto.createHash('sha256').update(s).digest()
	const c = crypto.createCipheriv('aes-256-gcm', k, iv)
	const ct = Buffer.concat([c.update(key, 'utf8'), c.final()])
	return [
		iv.toString('base64url'),
		c.getAuthTag().toString('base64url'),
		ct.toString('base64url'),
	].join('.')
}

function decrypt(blob) {
	if (!blob) return null
	const s = secret()
	if (!s) return null
	try {
		const [iv, tag, ct] = String(blob).split('.')
		const k = crypto.createHash('sha256').update(s).digest()
		const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'))
		d.setAuthTag(Buffer.from(tag, 'base64url'))
		return Buffer.concat([
			d.update(Buffer.from(ct, 'base64url')),
			d.final(),
		]).toString('utf8')
	} catch {
		return null
	}
}

// Мастер-ключ только если он явно задан в окружении. Дефолтного значения нет:
// иначе тестовый ключ из репозитория стал бы пропуском к OBS любого стримера.
function masterKey() {
	return process.env.OBS_CONTROL_KEY || ''
}

async function verify(room, key) {
	if (!room || !key) return false
	const master = masterKey()
	if (master && same(key, master)) return true
	const s = db()
	const h = hash(key)
	if (!s) {
		const rec = mem.get(room)
		return !!rec && same(rec.hash, h)
	}
	await ready
	try {
		const rows = await s`
			SELECT 1 FROM obs_access WHERE room = ${room} AND key_hash = ${h}
		`
		return rows.length > 0
	} catch {
		return false
	}
}

// rotate=false — вернуть уже выданный ключ (ссылка не ломается);
// rotate=true — выпустить новый (старый перестаёт работать).
async function mint(room, rotate = false) {
	const id = room || crypto.randomBytes(12).toString('hex')
	const s = db()
	if (!s) {
		const cur = mem.get(id)
		if (cur && !rotate) {
			const key = decrypt(cur.enc)
			if (key) return { room: id, key, rotated: false }
		}
		const key = crypto.randomBytes(18).toString('base64url')
		mem.set(id, { hash: hash(key), enc: encrypt(key) })
		return { room: id, key, rotated: true }
	}
	await ready
	if (!rotate) {
		try {
			const rows = await s`SELECT key_enc FROM obs_access WHERE room = ${id}`
			const key = rows.length ? decrypt(rows[0].key_enc) : null
			if (key) return { room: id, key, rotated: false }
		} catch {}
	}
	const key = crypto.randomBytes(18).toString('base64url')
	await s`
		INSERT INTO obs_access (room, key_hash, key_enc)
		VALUES (${id}, ${hash(key)}, ${encrypt(key)})
		ON CONFLICT (room) DO UPDATE
		SET key_hash = EXCLUDED.key_hash, key_enc = EXCLUDED.key_enc, created_at = now()
	`
	return { room: id, key, rotated: true }
}

module.exports = { verify, mint }
