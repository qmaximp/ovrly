// Доступ в админ-панель. Список логинов Twitch: по умолчанию владелец проекта
// и его помощник, на хостинге переопределяется переменной ADMIN_LOGINS
// (через запятую). Тот же список продублирован в server.js — держать в синхроне!
const DEFAULT_ADMINS = ['jettle_', 'nezory_1']

export function adminLogins(): string[] {
	const raw = process.env.ADMIN_LOGINS
	return (raw ? raw.split(',') : DEFAULT_ADMINS)
		.map(s => s.trim().toLowerCase())
		.filter(Boolean)
}

export function isAdminLogin(login: string | null | undefined): boolean {
	if (!login) return false
	return adminLogins().includes(login.toLowerCase())
}
