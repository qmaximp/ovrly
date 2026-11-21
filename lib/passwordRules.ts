// Правила надёжности пароля — чистые функции без Node API, чтобы один и
// тот же код использовали сервер (проверка при регистрации) и браузер (шкала
// под полем пароля). Так клиент не может «обойти» проверку: сервер считает
// то же самое независимо.

// Не «топ-10000», но отсекает самые частые пароли и их вариации с цифрами.
const COMMON = new Set([
	'12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
	'qwerty123', 'qwertyuiop', 'qwerty', 'iloveyou', 'admin123', 'welcome',
	'welcome1', 'monkey123', 'dragon123', 'football', 'baseball', 'sunshine',
	'princess', 'letmein1', 'trustno1', 'abc12345', '1q2w3e4r', '1qaz2wsx',
	'zaq12wsx', 'superman', 'starwars', 'whatever', 'computer', 'microsoft',
	'google123', 'telegram', 'instagram', 'tiktok123', 'minecraft', 'fortnite',
	'streamer', 'twitch123', 'ovrly123', 'пароль123', 'йцукен123', 'любовь123',
])

const SEQUENCES = [
	'0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl',
	'zxcvbnm', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю',
]

function hasSequence(lower: string): boolean {
	for (const seq of SEQUENCES) {
		for (let i = 0; i + 3 <= seq.length; i++) {
			const part = seq.slice(i, i + 3)
			if (lower.includes(part) || lower.includes([...part].reverse().join(''))) {
				return true
			}
		}
	}
	return false
}

export type PasswordCheck = {
	ok: boolean
	score: 0 | 1 | 2 | 3 | 4
	label: string
	issues: string[]
}

export function checkPassword(password: string, email?: string | null): PasswordCheck {
	const issues: string[] = []
	const lower = password.toLowerCase()

	if (password.length < 8) issues.push('Минимум 8 символов')
	if (password.length > 200) issues.push('Слишком длинный пароль (до 200 символов)')
	if (!/[a-zа-яё]/i.test(password)) issues.push('Добавьте хотя бы одну букву')
	if (!/\d/.test(password)) issues.push('Добавьте хотя бы одну цифру')
	if (/^\s|\s$/.test(password)) issues.push('Пробелы по краям не считаются')

	if (COMMON.has(lower)) issues.push('Этот пароль есть в списках утечек')
	if (email) {
		const local = email.split('@')[0]?.toLowerCase()
		if (local && local.length >= 3 && lower.includes(local)) {
			issues.push('Пароль не должен содержать почту')
		}
	}
	if (/(.)\1{2,}/.test(password)) issues.push('Не повторяйте один символ три раза подряд')
	if (hasSequence(lower)) issues.push('Избегайте последовательностей вроде 123 или qwerty')

	// Оценка 0–4. Длину ценим сильнее «спецсимволов»: она реально повышает
	// стойкость, а «P@ssw0rd!» из словаря — нет.
	let score = 0
	if (password.length >= 8) score++
	if (password.length >= 12) score++
	if (/[a-zа-яё]/i.test(password) && /\d/.test(password)) score++
	if (/[^a-zа-яё0-9]/i.test(password)) score++
	if (COMMON.has(lower) || hasSequence(lower)) score = Math.min(score, 1)
	if (email) {
		const local = email.split('@')[0]?.toLowerCase()
		if (local && local.length >= 3 && lower.includes(local)) score = Math.min(score, 1)
	}
	if (password.length < 8) score = 0

	const labels = ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Надёжный']
	const clamped = Math.max(0, Math.min(4, score)) as PasswordCheck['score']

	return {
		ok: issues.length === 0,
		score: clamped,
		label: labels[clamped],
		issues,
	}
}
