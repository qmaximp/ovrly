import crypto from 'crypto'

// Пароли: scrypt с солью на пользователя. Формат строки —
// scrypt$N$r$p$<salt hex>$<hash hex>, чтобы параметры можно было поднять
// позже без сброса старых паролей.

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function scrypt(
	password: string,
	salt: Buffer,
	keylen: number,
	n: number,
	r: number,
	p: number,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		crypto.scrypt(
			password,
			salt,
			keylen,
			{ N: n, r, p, maxmem: 64 * 1024 * 1024 },
			(err, key) => (err ? reject(err) : resolve(key)),
		)
	})
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16)
	const key = await scrypt(password, salt, KEYLEN, N, R, P)
	return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
	try {
		const [scheme, n, r, p, saltHex, keyHex] = hash.split('$')
		if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
		const expected = Buffer.from(keyHex, 'hex')
		const actual = await scrypt(
			password,
			Buffer.from(saltHex, 'hex'),
			expected.length,
			Number(n),
			Number(r),
			Number(p),
		)
		return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
	} catch {
		return false
	}
}

// Сравнение без утечки длины: использует одну и ту же работу, даже если
// пользователя с таким email нет (защита от перебора по времени ответа).
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${'00'.repeat(16)}$${'00'.repeat(KEYLEN)}`

export async function burnPasswordCheck(password: string): Promise<void> {
	await verifyPassword(DUMMY_HASH, password)
}


// Проверка надёжности вынесена в passwordRules, чтобы её использовал и клиент.
export { checkPassword, type PasswordCheck } from './passwordRules'
