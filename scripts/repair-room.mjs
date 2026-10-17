#!/usr/bin/env node
// Точечное восстановление комнаты из data/rooms в PostgreSQL.
// Нужно, если state в БД оказался битым/пустым, а JSON-файл цел.
// Для небольших комнат: файл читается через JSON.parse/stringify.
//
//   node --env-file=.env.local scripts/repair-room.mjs <room-key>
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import postgres from 'postgres'

const require = createRequire(import.meta.url)
const { roomFile } = require('../lib/roomStore.js')

const key = process.argv[2]
if (!key) {
	console.error('usage: node --env-file=.env.local scripts/repair-room.mjs <room-key>')
	process.exit(1)
}
const url = process.env.DATABASE_URL
if (!url) {
	console.error('DATABASE_URL не задан')
	process.exit(1)
}
const roomsDir = process.env.DATA_DIR
	? path.join(path.resolve(process.env.DATA_DIR), 'rooms')
	: path.join(process.cwd(), 'data', 'rooms')
const file = roomFile(roomsDir, key)
const data = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!data || !data.state || !Array.isArray(data.state.elements)) {
	console.error('в JSON-файле нет state.elements:', file)
	process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })
try {
	await sql`
		UPDATE rooms
		SET state = ${JSON.stringify(data.state)}::jsonb, updated_at = now()
		WHERE key = ${key}
	`
	console.log('восстановлено:', key.slice(0, 12), 'элементов:', data.state.elements.length)
} finally {
	await sql.end({ timeout: 5 })
}
