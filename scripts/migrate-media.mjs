#!/usr/bin/env node
// Перенос base64-медиа из комнат в файловое хранилище (локальный диск или R2).
//
// Запуск (на VDS, при остановленном приложении!):
//   systemctl stop ovrly
//   su - ovrly -c 'cd ~/ovrly && node --max-old-space-size=1500 --env-file=.env.local scripts/migrate-media.mjs'
//   systemctl start ovrly
//
// Флаги:
//   --dry-run        только посчитать, ничего не менять
//   --room <key>     одна комната (можно первые 8 символов); нужен для комнат 100+ МБ
//
// Скрипт идемпотентен: data-URL заменяется на URL, повторный запуск ничего не
// находит. Большие комнаты без --room пропускаются, чтобы случайный полный
// прогон не повторил OOM: их переносим по одной.
import { createRequire } from 'node:module'
import postgres from 'postgres'

const require = createRequire(import.meta.url)
// Старые медиа могли быть больше интерактивных лимитов панели — разрешаем
// писать до абсолютного MEDIA_MAX_BYTES (64 МБ по умолчанию).
process.env.MEDIA_MIGRATE = '1'
const { mediaConfig, putDataUrl } = require('../lib/mediaStore.js')

const url = process.env.DATABASE_URL
if (!url) {
	console.error('DATABASE_URL не задан. Запусти с --env-file=.env.local')
	process.exit(1)
}
const config = mediaConfig()
if (!config) {
	console.error(
		'Хранилище медиа не настроено: задай MEDIA_DIR (локальный диск) или R2_* (Cloudflare R2)',
	)
	process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')
const roomIndex = process.argv.indexOf('--room')
const onlyRoom = roomIndex >= 0 ? String(process.argv[roomIndex + 1] || '') : ''
if (roomIndex >= 0 && !onlyRoom) {
	console.error('usage: --room <key>')
	process.exit(1)
}

console.log(
	'⚠️  Приложение ovrly должно быть остановлено: иначе оно перезапишет комнату из памяти.',
)
console.log(dryRun ? 'Режим: dry-run, база не меняется.' : 'Режим: запись в БД.')

const MAX_MEDIA = 64 * 1024 * 1024
const sql = postgres(url, { max: 1, onnotice: () => {} })

function matches(key) {
	return !onlyRoom || key === onlyRoom || key.startsWith(onlyRoom)
}

function mb(bytes) {
	return (bytes / 1024 / 1024).toFixed(1)
}

// Любое строковое поле элемента, начинающееся с data:, — медиа. Сейчас это
// src и soundSrc, но так перенос покроет и будущие поля.
function mediaFields(el) {
	const fields = []
	for (const [field, value] of Object.entries(el || {})) {
		if (typeof value === 'string' && value.startsWith('data:')) fields.push(field)
	}
	return fields
}

async function processRoom(key, rawState) {
	const sizeMb = Number(mb(typeof rawState === 'string' ? rawState.length : 0))
	const isLarge = typeof rawState === 'string' && rawState.length > MAX_MEDIA
	if (isLarge && !onlyRoom) {
		console.log(
			`room ${key.slice(0, 8)}: ${sizeMb} МБ — пропущена (запусти с --room ${key.slice(0, 8)})`,
		)
		return { skippedLarge: true }
	}

	console.log(`room ${key.slice(0, 8)}: ${sizeMb ? sizeMb + ' МБ, ' : ''}разбираю…`)
	const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState
	// исходная строка на 100+ МБ больше не нужна — отпускаем до обхода элементов
	rawState = null
	if (!state || !Array.isArray(state.elements)) {
		console.warn('  нет elements — пропуск')
		return {}
	}

	let changed = 0
	let uploaded = 0
	let failed = 0
	let skipped = 0
	let bytes = 0

	for (const el of state.elements) {
		for (const field of mediaFields(el)) {
			const value = el[field]
			if (dryRun) {
				changed++
				bytes += value.length
				console.log(`  [dry] ${el.id?.slice(0, 8) ?? '?'} ${field}: ${mb(value.length)} МБ base64`)
				continue
			}
			try {
				const media = await putDataUrl(value)
				if (!media) {
					skipped++
					console.warn(
						`  [skip] ${el.id?.slice(0, 8) ?? '?'} ${field}: неизвестный тип ${value.slice(0, 32)}`,
					)
					continue
				}
				el[field] = media.url
				changed++
				uploaded++
				bytes += media.size
				console.log(
					`  ${el.id?.slice(0, 8) ?? '?'} ${field}: ${mb(media.size)} МБ -> ${media.url}`,
				)
			} catch (e) {
				failed++
				console.error(`  [error] ${el.id?.slice(0, 8) ?? '?'} ${field}: ${e.message}`)
			}
		}
	}

	if (!dryRun && changed) {
		await sql`
			UPDATE rooms
			SET state = ${sql.json(state)}, updated_at = now()
			WHERE key = ${key}
		`
		console.log(`  сохранено: ${key.slice(0, 8)}, заменено медиа: ${changed}`)
	}

	return { changed, uploaded, failed, skipped, bytes }
}

try {
	const keys = await sql`SELECT key FROM rooms ORDER BY key`
	let rooms = 0
	let totalChanged = 0
	let totalUploaded = 0
	let totalFailed = 0
	let totalSkipped = 0
	let totalBytes = 0

	for (const { key } of keys) {
		if (!matches(key)) continue
		const [row] = await sql`SELECT state FROM rooms WHERE key = ${key}`
		if (!row) continue
		let rawState = row.state
		row.state = null
		let result
		try {
			result = await processRoom(key, rawState)
		} catch (e) {
			console.error(`room ${key.slice(0, 8)}: ошибка — ${e.message}`)
			result = { failed: 1 }
		}
		rawState = null
		if (result.skippedLarge) continue
		rooms++
		totalChanged += result.changed ?? 0
		totalUploaded += result.uploaded ?? 0
		totalFailed += result.failed ?? 0
		totalSkipped += result.skipped ?? 0
		totalBytes += result.bytes ?? 0
		// после большой комнаты помогаем GC освободить распарсенное состояние
		if (typeof global.gc === 'function') global.gc()
	}

	console.log(
		`\nИтого: комнат ${rooms}, заменено ${totalChanged}, загружено в R2 ${totalUploaded}, ` +
			`ошибок ${totalFailed}, пропущено ${totalSkipped}, объём ${mb(totalBytes)} МБ` +
			(dryRun ? ' (dry-run, база не изменялась)' : ''),
	)
	if (totalFailed) process.exitCode = 1
} catch (e) {
	console.error('Ошибка миграции медиа:', e.message)
	process.exitCode = 1
} finally {
	await sql.end({ timeout: 5 })
}
