// Выбор пользователя по cookie. Хранится в localStorage, потому что сам
// выбор не является персональными данными и не должен уезжать на сервер.
const NOTICE_KEY = 'ovrly_cookie_notice_v1'
const SHARE_KEY = 'ovrly_cookie_share_v1'

// По умолчанию ничего не передаём: необязательные трекеры должны явно
// получить «да», а не работать до первого клика.
export function cookieShareAllowed(): boolean {
	try {
		return localStorage.getItem(SHARE_KEY) === '1'
	} catch {
		return false
	}
}

export function setCookieChoice(share: boolean): void {
	try {
		localStorage.setItem(
			NOTICE_KEY,
			JSON.stringify({ at: new Date().toISOString(), share }),
		)
		localStorage.setItem(SHARE_KEY, share ? '1' : '0')
		window.dispatchEvent(
			new CustomEvent('ovrly:cookie-choice', { detail: { share } }),
		)
	} catch {
		// приватный режим — выбор просто не сохранится
	}
}
