// Хранилище медиа: локальный диск (MEDIA_DIR) или Cloudflare R2.
//
// Ни MEDIA_DIR, ни R2_* не заданы -> поведение прежнее: файлы с ПК уходят в
// состояние комнаты как base64 data-URL. Заданы -> файл кладём на диск или в R2,
// в состоянии остаётся только короткий URL. Ключ объекта — sha256 содержимого:
// одинаковые файлы не дублируются, ссылку можно кэшировать навсегда.
// Если заданы оба backend'а, приоритет у R2.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { AwsClient } = require('aws4fetch')

const MB = 1024 * 1024

// Абсолютный предохранитель на один файл. Клиентские лимиты ниже (звук 2 МБ,
// видео 40 МБ), поэтому сюда попадают только картинки и миграция старых медиа.
const MAX_MEDIA_BYTES = Number(process.env.MEDIA_MAX_BYTES || 64 * MB)
const IMAGE_MAX_BYTES = 20 * MB
const VIDEO_MAX_BYTES = 40 * MB
const SOUND_MAX_BYTES = 5 * MB

// Разрешённые типы: только то, что браузер умеет показать/проиграть.
// SVG намеренно не принимаем: как отдельный документ он может исполнить скрипт.
const TYPES = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/x-ms-bmp': 'bmp',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'video/quicktime': 'mov',
	'video/ogg': 'ogv',
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
	'audio/ogg': 'ogg',
	'audio/aac': 'aac',
	'audio/mp4': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/webm': 'weba',
}

const EXTENSIONS = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	ogv: 'video/ogg',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	aac: 'audio/aac',
	m4a: 'audio/mp4',
	weba: 'audio/webm',
}

let client = null
let clientKey = ''

function env(name) {
	const value = process.env[name]
	return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function config() {
	const endpoint = env('R2_ENDPOINT').replace(/\/+$/, '')
	const bucket = env('R2_BUCKET')
	const accessKeyId = env('R2_ACCESS_KEY_ID')
	const secretAccessKey = env('R2_SECRET_ACCESS_KEY')
	const publicUrl = env('R2_PUBLIC_URL').replace(/\/+$/, '')
	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicUrl) {
		return null
	}
	return { endpoint, bucket, accessKeyId, secretAccessKey, publicUrl }
}

function isConfigured() {
	return !!config() || !!mediaDir()
}

// Локальный backend: файлы лежат на диске VDS, nginx отдаёт их по /media/.
// Требуем явный MEDIA_DIR, чтобы локальная разработка без настройки продолжала
// работать на base64 и ничего не писала в проект.
function mediaDir() {
	const dir = env('MEDIA_DIR')
	return dir ? path.resolve(dir) : ''
}

// Клиент пересоздаётся только если сменились креды/endpoint (например, в скрипте
// миграции окружение подменили между вызовами).
function clientFor(cfg) {
	const key = `${cfg.endpoint}|${cfg.accessKeyId}`
	if (!client || clientKey !== key) {
		client = new AwsClient({
			accessKeyId: cfg.accessKeyId,
			secretAccessKey: cfg.secretAccessKey,
			service: 's3',
			region: 'auto',
			// тело-буфер можно безопасно повторить, но 10 ретраев на 40 МБ — перебор
			retries: 2,
		})
		clientKey = key
	}
	return client
}

function resolveType(contentType, fileName) {
	let type = String(contentType || '')
		.toLowerCase()
		.split(';')[0]
		.trim()
	if (type === 'image/jpg') type = 'image/jpeg'
	if (TYPES[type]) return { contentType: type, ext: TYPES[type] }
	const ext = /\.([a-z0-9]+)$/i.exec(String(fileName || ''))?.[1]?.toLowerCase()
	if (ext && EXTENSIONS[ext]) {
		return {
			contentType: EXTENSIONS[ext],
			ext: ext === 'jpeg' ? 'jpg' : ext,
		}
	}
	return null
}

function limitFor(contentType) {
	if (contentType.startsWith('image/')) return IMAGE_MAX_BYTES
	if (contentType.startsWith('video/')) return VIDEO_MAX_BYTES
	if (contentType.startsWith('audio/')) return SOUND_MAX_BYTES
	return MAX_MEDIA_BYTES
}

function fail(code, message) {
	const error = new Error(message)
	error.code = code
	return error
}

// Проверка размера/типа — отдельно, чтобы API мог ответить 413/415 без загрузки.
function prepare(buffer, contentType, fileName) {
	if (!buffer || !buffer.length) throw fail('EMPTY', 'empty file')
	const info = resolveType(contentType, fileName)
	if (!info) throw fail('UNSUPPORTED', `unsupported media type: ${contentType || 'unknown'}`)
	const limit = Math.min(MAX_MEDIA_BYTES, limitFor(info.contentType))
	if (buffer.length > limit) {
		const error = fail('TOO_LARGE', 'file too large')
		error.limit = limit
		throw error
	}
	return info
}

function makeKey(buffer, ext) {
	const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32)
	return `${hash}.${ext}`
}

function encodeKey(key) {
	return key.split('/').map(encodeURIComponent).join('/')
}

// R2: объект лежит в bucket под префиксом media/, публичный URL — от R2_PUBLIC_URL.
function publicUrl(cfg, key) {
	return `${cfg.publicUrl}/media/${encodeKey(key)}`
}

function objectUrl(cfg, key) {
	return `${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/media/${encodeKey(key)}`
}

// Локальный диск: файл <MEDIA_DIR>/<hash>.<ext>, nginx отдаёт его по /media/.
// Контент-адресация делает запись идемпотентной: одинаковый файл не пишется дважды.
function putLocal(dir, buffer, key, contentType) {
	const file = path.join(dir, key)
	try {
		fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
		let exists = false
		try {
			exists = fs.statSync(file).size === buffer.length
		} catch {}
		if (!exists) {
			const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
			fs.writeFileSync(tmp, buffer, { mode: 0o644 })
			fs.renameSync(tmp, file)
		}
	} catch (e) {
		throw fail('UPLOAD_FAILED', `local media write: ${e.message}`)
	}
	return {
		key,
		url: `/media/${encodeKey(key)}`,
		size: buffer.length,
		contentType,
	}
}

async function putBuffer(buffer, contentType, fileName) {
	if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer)
	const info = prepare(buffer, contentType, fileName)
	const key = makeKey(buffer, info.ext)

	const cfg = config()
	if (cfg) {
		const response = await clientFor(cfg).fetch(objectUrl(cfg, key), {
			method: 'PUT',
			body: buffer,
			headers: {
				'Content-Type': info.contentType,
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		})
		if (!response.ok) {
			const text = await response.text().catch(() => '')
			throw fail('UPLOAD_FAILED', `R2 ${response.status}: ${text.slice(0, 200)}`)
		}
		return {
			key,
			url: publicUrl(cfg, key),
			size: buffer.length,
			contentType: info.contentType,
		}
	}

	const dir = mediaDir()
	if (dir) return putLocal(dir, buffer, key, info.contentType)

	throw fail('NOT_CONFIGURED', 'media storage is not configured')
}

// data-URL из старых комнат: "data:image/png;base64,...."
function parseDataUrl(value) {
	if (typeof value !== 'string' || !value.startsWith('data:')) return null
	const comma = value.indexOf(',')
	if (comma < 0) return null
	const meta = value.slice(5, comma)
	const payload = value.slice(comma + 1)
	const parts = meta.split(';')
	const type = (parts[0] || '').trim().toLowerCase() || 'application/octet-stream'
	const base64 = parts
		.slice(1)
		.some(part => part.trim().toLowerCase() === 'base64')
	try {
		const buffer = base64
			? Buffer.from(payload, 'base64')
			: Buffer.from(decodeURIComponent(payload), 'utf8')
		if (!buffer.length) return null
		return { buffer, type }
	} catch {
		return null
	}
}

// У старых файлов MIME мог потеряться (application/octet-stream) — определяем
// по сигнатуре. Нужно только миграции, новые загрузки всегда несут тип.
function sniffType(buffer) {
	const head = buffer.subarray(0, 12)
	if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
		return 'image/png'
	if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
	if (head.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
	if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP')
		return 'image/webp'
	if (head[0] === 0x42 && head[1] === 0x4d) return 'image/bmp'
	if (head.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
	if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE')
		return 'audio/wav'
	if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
		return 'video/webm'
	if (head.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
	if (
		head.toString('ascii', 0, 3) === 'ID3' ||
		(head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
	)
		return 'audio/mpeg'
	return null
}

async function putDataUrl(value) {
	const parsed = parseDataUrl(value)
	if (!parsed) return null
	let type = parsed.type
	if (!TYPES[type]) {
		const sniffed = sniffType(parsed.buffer)
		if (sniffed) type = sniffed
	}
	const info = resolveType(type, '')
	if (!info) return null
	return putBuffer(parsed.buffer, info.contentType, `file.${info.ext}`)
}

// Конфиг для клиента: без R2/MEDIA_DIR эндпоинт отвечает 501, панель
// откатывается на base64. Если заданы оба backend'а, приоритет у R2.
function mediaConfig() {
	const cfg = config()
	const dir = mediaDir()
	if (!cfg && !dir) return null
	return {
		enabled: true,
		storage: cfg ? 'r2' : 'local',
		maxBytes: MAX_MEDIA_BYTES,
		imageMaxBytes: IMAGE_MAX_BYTES,
		videoMaxBytes: VIDEO_MAX_BYTES,
		soundMaxBytes: SOUND_MAX_BYTES,
	}
}

module.exports = {
	isConfigured,
	mediaConfig,
	putBuffer,
	putDataUrl,
	parseDataUrl,
	resolveType,
}
