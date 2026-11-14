// Перенос старой истории группы Telegram в «Список обновлений».
//
// Bot API не отдаёт сообщения, написанные до подключения бота, поэтому историю
// берём из экспорта Telegram Desktop: меню группы → «Экспорт истории чата» →
// формат JSON. Скрипт кладёт сообщения в те же записи, что и бот, и не создаёт
// дублей (id вида tg<chat_id>_<message_id>).
//
// Использование:
//   node --env-file=.env.local scripts/import-telegram-export.mjs result.json
//   node --env-file=.env.local scripts/import-telegram-export.mjs result.json --apply
//
// Без --apply работает в режиме проверки: показывает, сколько сообщений найдено
// и сколько из них новое. Картинки из экспорта не переносятся — Bot API отдаёт
// фото только для своих сообщений.
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const storage = require('../lib/storage.js')

const ENTRIES = 'changelog_entries'
const MAX_ENTRIES = 300

function textOf(value) {
	if (typeof value === 'string') return value
	if (!Array.isArray(value)) return ''
	return value
		.map(part => (typeof part === 'string' ? part : part?.text || ''))
		.join('')
}

function parseArgs(argv) {
	const args = { file: '', chat: 'ovrly_control', apply: false }
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--apply') args.apply = true
		else if (arg === '--dry-run') args.apply = false
		else if (arg === '--chat') args.chat = String(argv[++i] || '').trim()
		else if (!arg.startsWith('--') && !args.file) args.file = arg
	}
	return args
}

const args = parseArgs(process.argv.slice(2))
if (!args.file) {
	console.error(
		'Укажите путь к result.json из экспорта Telegram Desktop.\n' +
			'Пример: node --env-file=.env.local scripts/import-telegram-export.mjs result.json',
	)
	process.exit(1)
}

const raw = JSON.parse(fs.readFileSync(args.file, 'utf8'))
const messages = Array.isArray(raw?.messages) ? raw.messages : []
const chatId = raw?.id ?? ''
const username = String(raw?.username || args.chat || '')
	.trim()
	.replace(/^@/, '')

const entries = []
let skipped = 0

for (const msg of messages) {
	if (!msg || msg.type !== 'message') {
		skipped++
		continue
	}
	const text = textOf(msg.text).trim()
	if (!text) {
		skipped++
		continue
	}
	const seconds = Number(msg.date_unixtime)
	const date =
		Number.isFinite(seconds) && seconds > 0
			? new Date(seconds * 1000)
			: new Date(msg.date)
	entries.push({
		id: `tg${chatId}_${msg.id}`,
		text: text.slice(0, 4000),
		date: (Number.isFinite(date.getTime()) ? date : new Date()).toISOString(),
		url: username ? `https://t.me/${username}/${msg.id}` : '',
	})
}

const existingRaw = await storage.getSetting(ENTRIES)
const existing = Array.isArray(existingRaw) ? existingRaw : []
const seen = new Set(existing.map(entry => entry.id).filter(Boolean))

let added = 0
for (const entry of entries) {
	if (seen.has(entry.id)) continue
	seen.add(entry.id)
	existing.push(entry)
	added++
}

existing.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))

console.log(`Файл: ${args.file}`)
console.log(`Группа: @${username || '—'} (id ${chatId || '—'})`)
console.log(`Сообщений в экспорте: ${messages.length}, с текстом: ${entries.length}`)
console.log(`Служебных и пустых пропущено: ${skipped}`)
console.log(`Новых записей: ${added}, уже были: ${entries.length - added}`)

if (args.apply) {
	await storage.setSetting(ENTRIES, existing.slice(-MAX_ENTRIES))
	console.log(`Сохранено. Всего в списке обновлений: ${Math.min(existing.length, MAX_ENTRIES)}`)
} else {
	console.log('Это проверка. Повторите с --apply, чтобы записать в базу.')
}
