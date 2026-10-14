// Сохранение состояния комнат на диск.
//
// Зачем: состояние оверлея живёт в памяти сервера (base64-медиа, координаты
// элементов). Раньше оно стиралось «через 3 часа без изменений», а рестарт сервера
// убивал его сразу. Теперь каждая комната пишется в JSON-файл, поэтому элементы
// переживают и рестарт, и деплой (если DATA_DIR на смонтированном томе).
//
// Имя файла — хеш имени комнаты: имя приходит из query и может содержать что угодно
// (включая слэши), а хеш детерминированный — по нему же читаем обратно.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function roomFile(dir, key) {
	const h = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 16)
	return path.join(dir, `room-${h}.json`)
}

// Прочитать сохранённое состояние комнаты (null — если ничего нет или файл битый)
function loadRoom(dir, key) {
	try {
		const data = JSON.parse(fs.readFileSync(roomFile(dir, key), 'utf8'))
		if (data && data.state && Array.isArray(data.state.elements)) return data.state
	} catch {}
	return null
}

// Записать состояние: пишем в временный файл и переименовываем, чтобы читатель
// никогда не увидел обрезанный JSON
function saveRoom(dir, key, state) {
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

function deleteRoom(dir, key) {
	try {
		fs.unlinkSync(roomFile(dir, key))
	} catch {}
}

// Сколько примерно занимают элементы комнаты (base64-медиа — основная память).
// Нужно для предохранителя: одна комната не должна съесть всю RAM сервера
function roomBytes(state) {
	let n = 0
	for (const el of state.elements) n += (el && el.src ? el.src.length : 0) + 256
	return n
}

module.exports = { roomFile, loadRoom, saveRoom, deleteRoom, roomBytes }
