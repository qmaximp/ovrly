// Telegram-канал: принимаем @name, name и любые ссылки t.me/name.
export function normalizeTelegramChannel(raw?: string): string {
	let s = String(raw ?? '').trim()
	s = s.replace(/^https?:\/\/t\.me\//i, '')
	s = s.replace(/^t\.me\//i, '')
	s = s.replace(/^@/, '')
	s = s.replace(/^s\//i, '')
	s = s.split(/[/?#]/)[0] || ''
	return s.replace(/[^A-Za-z0-9_]/g, '').slice(0, 64)
}

export function telegramChannelUrl(channel: string): string {
	return `https://t.me/${normalizeTelegramChannel(channel)}`
}
