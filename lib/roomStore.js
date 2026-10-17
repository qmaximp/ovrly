// Сохранение состояния комнат.
//
// DATABASE_URL задан  -> таблица rooms в PostgreSQL
// DATABASE_URL пустой -> JSON-файлы в data/rooms (локальная разработка)
//
// Функции асинхронные: server.js ждёт загрузку/сохранение. roomBytes остаётся
// синхронным — это только подсчёт длины строк.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let sql = null

function db() {
	if (!process.env.DATABASE_URL) return null
	if (!sql) {
		const postgres = require('postgres')
		sql = postgres(process.env.DATABASE_URL, {
			max: 3,
			idle_timeout: 20,
			onnotice: () => {},
		})
	}
	return sql
}

function roomFile(dir, key) {
	const h = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16)
	return path.join(dir, `room-${h}.json`)
}

// Прочитать комнату из JSON-файла (null — если ничего нет или файл битый).
// Отдельная функция нужна как fallback, если в БД комнаты ещё нет.
function loadRoomJson(dir, key) {
	try {
		const data = JSON.parse(fs.readFileSync(roomFile(dir, key), 'utf8'))
		if (data && data.state && Array.isArray(data.state.elements)) return data.state
	} catch {}
	return null
}

// Прочитать сохранённое состояние комнаты
async function loadRoom(dir, key) {
	if (process.env.DATABASE_URL) {
		try {
			const rows = await db()`
				SELECT state FROM rooms WHERE key = ${String(key)} LIMIT 1
			`
			if (!rows[0]) return null
			const state =
				typeof rows[0].state === 'string'
					? JSON.parse(rows[0].state)
					: rows[0].state
			return state && Array.isArray(state.elements) ? state : null
		} catch (e) {
			console.log('[ovrly] не удалось загрузить комнату из БД:', e.message)
			return null
		}
	}
	return loadRoomJson(dir, key)
}

// Записать состояние: в JSON пишем во временный файл и переименовываем, чтобы
// читатель никогда не увидел обрезанный JSON; в БД — upsert.
async function saveRoom(dir, key, state) {
	if (process.env.DATABASE_URL) {
		try {
			await db()`
				INSERT INTO rooms (key, state, updated_at)
				VALUES (${String(key)}, ${JSON.stringify(state)}::jsonb, now())
				ON CONFLICT (key) DO UPDATE SET
					state = EXCLUDED.state,
					updated_at = now()
			`
			return true
		} catch (e) {
			console.log('[ovrly] не удалось сохранить комнату в БД:', e.message)
			return false
		}
	}
	const file = roomFile(dir, key)
	const tmp = `${file}.${process.pid}.tmp`
	const text = JSON.stringify({ key, savedAt: Date.now(), state })
	try {
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(tmp, text)
		fs.renameSync(tmp, file)
		return true
	} catch (e) {
		try {
			fs.unlinkSync(tmp)
		} catch {}
		console.log('[ovrly] не удалось сохранить комнату:', e.message)
		return false
	}
}

async function deleteRoom(dir, key) {
	if (process.env.DATABASE_URL) {
		try {
			await db()`DELETE FROM rooms WHERE key = ${String(key)}`
		} catch {}
		return
	}
	try {
		fs.unlinkSync(roomFile(dir, key))
	} catch {}
}

// Сколько примерно занимают элементы комнаты (base64-медиа — основная память).
// Нужно для предохранителя: одна комната не должна съесть всю RAM сервера
function roomBytes(state) {
	let n = 0
	for (const el of state.elements) {
		// звук таймера тоже лежит в состоянии (data-URL) и занимает память —
		// без него большая комната выглядела в админке «пустой» по объёму
		n += (el && el.src ? el.src.length : 0) + (el && el.soundSrc ? el.soundSrc.length : 0) + 256
	}
	return n
}

module.exports = { roomFile, loadRoom, loadRoomJson, saveRoom, deleteRoom, roomBytes }
