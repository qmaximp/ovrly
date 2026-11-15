const { createServer } = require('http')
const next = require('next')
const { Server } = require('socket.io')
const crypto = require('crypto')
const path = require('path')
const WebSocket = require('ws')
const roomStore = require('./lib/roomStore')
const obsAccess = require('./lib/obsAccess')

// режим запуска: npm run dev (--dev) / npm start (--prod).
// Флаги вместо NODE_ENV=... в скрипте: одна и та же команда работает и на Windows
const dev = process.argv.includes('--dev')
	? true
	: process.argv.includes('--prod')
		? false
		: process.env.NODE_ENV !== 'production'

// Кастомный сервер и Next работают в одном процессе, но .env.local нужно
// загрузить до создания приложения: иначе server.js/roomStore не увидят
// DATABASE_URL, хотя API-роуты Next его увидят.
const { loadEnvConfig } = require('@next/env')
loadEnvConfig(process.cwd(), dev)

const app = next({ dev })
const handle = app.getRequestHandler()

const CANVAS_W = 1920
const CANVAS_H = 1080

// каталог данных (links.json / invites.json / owner.json / rooms/). На хостинге с
// эфемерной ФС монтируйте том и укажите DATA_DIR — иначе ссылки, инвайты, токены
// смайликов и элементы оверлея теряются при каждом рестарте/деплое.
// Читаем лениво: значения из .env.local попадают в process.env только после
// app.prepare() (Next загружает их сам), а модуль server.js исполняется раньше
function dataDir() {
	return process.env.DATA_DIR
		? path.resolve(process.env.DATA_DIR)
		: path.join(__dirname, 'data')
}

function roomsDir() {
	return path.join(dataDir(), 'rooms')
}

// секрет подписи cookie-сессии — тот же порядок, что в lib/session.ts.
// Тоже лениво: иначе секрет из .env.local не успел бы примениться
function sessionSecret() {
	return (
		process.env.SESSION_SECRET || process.env.TWITCH_CLIENT_SECRET || 'ovrly-dev-secret'
	)
}

// гостям (оверлей в OBS — без cookie-сессии) доступно только чтение: из событий
// разрешены лишь служебные, состояние оверлея меняют только авторизованные панели
const READ_ONLY_EVENTS = new Set(['cursor:move', 'overlay:hello'])

// Команды OBS от зрителя: только фиксированный набор, без произвольных запросов.
// Всё, что не описано здесь, до моста не доходит.
function cleanObsCmd(d) {
	if (!d || typeof d !== 'object') return null
	const s = v => (typeof v === 'string' ? v.slice(0, 128) : '')
	const id = Number.isInteger(d.id) ? d.id : undefined
	switch (d.action) {
		case 'scene.set':
			return d.scene ? { id, action: 'scene.set', scene: s(d.scene) } : null
		case 'item.visible':
			return d.scene && Number.isInteger(d.sceneItemId) && typeof d.visible === 'boolean'
				? {
						id,
						action: 'item.visible',
						scene: s(d.scene),
						sceneItemId: d.sceneItemId,
						visible: d.visible,
					}
				: null
		case 'item.locked':
			return d.scene && Number.isInteger(d.sceneItemId) && typeof d.locked === 'boolean'
				? {
						id,
						action: 'item.locked',
						scene: s(d.scene),
						sceneItemId: d.sceneItemId,
						locked: d.locked,
					}
				: null
		case 'item.order':
			return d.scene && Number.isInteger(d.sceneItemId) && Number.isInteger(d.index) && d.index >= 0
				? {
						id,
						action: 'item.order',
						scene: s(d.scene),
						sceneItemId: d.sceneItemId,
						index: d.index,
					}
				: null
		case 'input.mute':
			return d.input && typeof d.muted === 'boolean'
				? { id, action: 'input.mute', input: s(d.input), muted: d.muted }
				: null
		case 'input.volume': {
			const db = Number(d.db)
			if (!d.input || !isFinite(db)) return null
			return {
				id,
				action: 'input.volume',
				input: s(d.input),
				db: Math.max(-100, Math.min(26, db)),
			}
		}
		default:
			return null
	}
}

// предел числа комнат: имя комнаты приходит из query и может быть любым, без лимита
// карта rooms росла бы бесконечно (каждая комната держит элементы своего стейта).
// При вытеснении комната сначала сохраняется на диск — вернётся, когда в неё зайдут снова
const MAX_ROOMS = 200

// предохранитель по памяти: медиа «с ПК» лежат в файлах, но старые комнаты ещё
// могут содержать base64. Для хостинга ~2 ГБ держим 24 МБ на комнату — это
// несколько десятков картинок и запас под оверлеи. Переопределяется env.
const MAX_ROOM_MB = Number(process.env.MAX_ROOM_MB || 24)
const MAX_ROOM_BYTES = MAX_ROOM_MB * 1024 * 1024

// общий предел памяти на все комнаты: при превышении выгружаем самые давние
// комнаты без подключений (их состояние остаётся на диске)
const MAX_TOTAL_ROOM_MB = Number(process.env.MAX_TOTAL_ROOM_MB || 320)
const MAX_TOTAL_ROOM_BYTES = MAX_TOTAL_ROOM_MB * 1024 * 1024

// Комнаты, созданные до переноса base64 в файлы, бывают больше нового лимита.
// Им разрешаем сохраняться, но не расти больше чем на 5%: иначе правки встанут
// намертво, пока медиа не мигрировано.
function roomLimit(currentBytes) {
	return currentBytes > MAX_ROOM_BYTES
		? Math.round(currentBytes * 1.05)
		: MAX_ROOM_BYTES
}

// мягкое предупреждение в панель при заполнении комнаты (не чаще раза в 10 минут)
function warnRoomLimit(io, rec, room, size) {
	if (size < MAX_ROOM_BYTES * 0.75 || size > MAX_ROOM_BYTES) return
	const now = Date.now()
	if (now - (rec.limitWarnAt || 0) < 10 * 60 * 1000) return
	rec.limitWarnAt = now
	io.to(room).emit('server:notice', {
		text: `В комнате занято ${Math.round(size / 1024 / 1024)} МБ из ${MAX_ROOM_MB} МБ. Большие файлы лучше добавлять ссылкой.`,
		at: now,
	})
}

// свой звук таймера хранится в стейте как base64; 3 МБ base64 — примерно 2,2 МБ файла.
// Клиент ограничивает файл 2 МБ, сервер дополнительно не даёт залить больше
const MAX_SOUND_DATA = 3 * 1024 * 1024

// элемент — это DOM-узел в оверлее у каждого зрителя; тысячи «пустых» элементов
// кладут и сервер (обход массива на каждое событие), и OBS. 400 с запасом
const MAX_ELEMENTS = 400

// прочие (не медиа) поля элемента тоже не должны быть безразмерными: раньше
// element:update принимал любые ключи, и ими можно было раздуть комнату в обход
// учёта base64-медиа
const MAX_ELEMENT_EXTRA = 512 * 1024

// id и координаты из сокета. Без проверки data.id === undefined роняло процесс,
// а данные приходили в состояние как есть (строки, NaN, объекты).
function asId(v) {
	return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
		? v
		: null
}
function asCoord(v, min = -100000, max = 100000) {
	return typeof v === 'number' && Number.isFinite(v)
		? Math.min(max, Math.max(min, v))
		: null
}
// обрезка медиа: доли краёв 0..0.98; null — обрезки нет
function cleanCrop(v) {
	if (!v || typeof v !== 'object') return null
	const n = x => Math.min(0.98, Math.max(0, Number(x) || 0))
	const c = { l: n(v.l), t: n(v.t), r: n(v.r), b: n(v.b) }
	if (c.l + c.r > 0.98 || c.t + c.b > 0.98) return null
	if (!c.l && !c.t && !c.r && !c.b) return null
	const round = x => Math.round(x * 10000) / 10000
	return { l: round(c.l), t: round(c.t), r: round(c.r), b: round(c.b) }
}
// группы слоёв: имя — просто строка, id — короткий безопасный
function cleanGroups(raw) {
	if (!Array.isArray(raw)) return []
	const out = []
	const seen = new Set()
	for (const g of raw.slice(0, 100)) {
		if (!g || typeof g !== 'object') continue
		const id = typeof g.id === 'string' ? g.id.replace(/[^\w-]/g, '').slice(0, 40) : ''
		if (!id || seen.has(id)) continue
		seen.add(id)
		out.push({
			id,
			name: String(g.name ?? 'Группа').slice(0, 60),
			collapsed: !!g.collapsed,
		})
	}
	return out
}

// рисунок: ограничиваем число штрихов, точек и длину
const MAX_STROKES = 200
const MAX_POINTS = 400
function cleanStroke(raw) {
	if (!raw || typeof raw !== 'object') return null
	const pts = Array.isArray(raw.points) ? raw.points : []
	const points = []
	for (const p of pts.slice(0, MAX_POINTS)) {
		if (!Array.isArray(p) || p.length < 2) continue
		const x = asCoord(Number(p[0]), -1000, 4000)
		const y = asCoord(Number(p[1]), -1000, 4000)
		if (x !== null && y !== null) points.push([Math.round(x), Math.round(y)])
	}
	if (points.length < 2) return null
	return {
		id: String(raw.id || Date.now() + '-' + Math.random().toString(36).slice(2, 8)).slice(0, 40),
		color: /^#[0-9a-f]{3,8}$/i.test(String(raw.color || '')) ? String(raw.color) : '#ff3b30',
		width: Math.max(1, Math.min(40, Number(raw.width) || 6)),
		points,
	}
}

// точки рисунка-элемента: локальные координаты внутри его рамки
const MAX_DRAW_POINTS = 1200
function cleanDrawPoints(raw, w, h) {
	if (!Array.isArray(raw)) return null
	const out = []
	for (const p of raw.slice(0, MAX_DRAW_POINTS)) {
		if (!Array.isArray(p) || p.length < 2) continue
		const x = asCoord(Number(p[0]), -10, Math.max(10, w) + 10)
		const y = asCoord(Number(p[1]), -10, Math.max(10, h) + 10)
		if (x !== null && y !== null)
			out.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10])
	}
	return out.length > 1 ? out : null
}

function cleanDrawStrokes(raw, w, h) {
	if (!Array.isArray(raw)) return null
	const out = []
	for (const s of raw.slice(0, 200)) {
		const points = cleanDrawPoints(s?.points, w, h)
		if (!points) continue
		out.push({
			points,
			color: /^#[0-9a-f]{3,8}$/i.test(String(s?.color || ''))
				? String(s.color)
				: '#ff3b30',
			width: Math.max(1, Math.min(80, Number(s?.width) || 6)),
		})
	}
	return out.length ? out : null
}

function cleanDrawElement(el) {
	const w = Math.max(4, Math.min(8000, Number(el.width) || 4))
	const h = Math.max(4, Math.min(8000, Number(el.height) || 4))
	const baseW = Math.max(4, Math.min(8000, Number(el.drawW) || w))
	const baseH = Math.max(4, Math.min(8000, Number(el.drawH) || h))
	if (el.drawW !== undefined) el.drawW = baseW
	if (el.drawH !== undefined) el.drawH = baseH
	const strokes = cleanDrawStrokes(el.strokes, baseW, baseH)
	if (strokes) {
		el.strokes = strokes
		el.points = strokes[0].points
		el.strokeColor = strokes[0].color
		el.strokeWidth = strokes[0].width
		return true
	}
	const points = cleanDrawPoints(el.points, baseW, baseH)
	if (!points) return false
	el.points = points
	delete el.strokes
	el.strokeColor = /^#[0-9a-f]{3,8}$/i.test(String(el.strokeColor || ''))
		? String(el.strokeColor)
		: '#ff3b30'
	el.strokeWidth = Math.max(1, Math.min(80, Number(el.strokeWidth) || 6))
	return true
}

// Telegram-канал: @name, name или ссылка t.me/name
function cleanTelegramChannel(raw) {
	let s = String(raw || '').trim()
	s = s.replace(/^https?:\/\/t\.me\//i, '')
	s = s.replace(/^t\.me\//i, '')
	s = s.replace(/^s\//i, '')
	s = s.replace(/^@/, '')
	return s.split(/[/?#]/)[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 64)
}

// размер «прочих» полей без медиа и уже проверенных widget/playlist
function extraBytes(obj) {
	try {
		const { src, soundSrc, widget, widgetValues, playlist, ...rest } = obj
		return JSON.stringify(rest).length
	} catch {
		return Infinity
	}
}

// YouTube-плейлист: в состоянии храним только id роликов, не произвольные URL.
// Это защищает и от мусора, и от подмены src при playlist:step.
const YT_ID_RE = /^[A-Za-z0-9_-]{6,20}$/
function cleanPlaylist(raw) {
	if (!Array.isArray(raw)) return null
	const out = []
	const seen = new Set()
	for (const id of raw.slice(0, 100)) {
		if (typeof id !== 'string' || !YT_ID_RE.test(id) || seen.has(id)) continue
		seen.add(id)
		out.push(id)
	}
	return out.length ? out : null
}

// --- кастомные виджеты ---
// Код виджета хранится в состоянии комнаты (библиотека на комнату). Всё, что
// приходит с клиента, проверяем: размеры, имена переменных, типы и лимиты.
const WIDGET_RESERVED = new Set([
	'is_overlay',
	'widget_width',
	'widget_height',
	'channel_name',
	'platform',
])
const WIDGET_TYPES = new Set([
	'string',
	'boolean',
	'toggle',
	'color',
	'media',
	'button',
	'slider',
	'dropdown',
	'datetime',
	'counter',
	'list',
	'checkboxes',
])
// Pogly не обновляет toggle/media на лету; кнопка — отдельный триггер
const WIDGET_NON_LIVE_TYPES = new Set(['button', 'toggle', 'media'])
const WIDGET_TWITCH_INTEGRATIONS = [
	'twitchChat',
	'twitchSubs',
	'twitchRaids',
	'twitchBits',
]
const WIDGET_CODE_TOTAL = 240 * 1024
const WIDGET_CODE_PART = 100 * 1024
const WIDGET_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function cleanWidgetOptions(raw) {
	if (!Array.isArray(raw)) return undefined
	const seen = new Set()
	const out = []
	for (const item of raw.slice(0, 50)) {
		const value = String(item ?? '').trim().slice(0, 100)
		if (!value || seen.has(value)) continue
		seen.add(value)
		out.push(value)
	}
	return out.length ? out : undefined
}

function cleanWidgetVariable(raw) {
	if (!raw || typeof raw !== 'object') return null
	const name = typeof raw.name === 'string' ? raw.name.trim() : ''
	if (!WIDGET_VAR_NAME_RE.test(name) || WIDGET_RESERVED.has(name)) return null
	const type = WIDGET_TYPES.has(raw.type) ? raw.type : 'string'
	const v = {
		name,
		type,
		value: String(raw.value ?? '').slice(0, 5000),
		live: !WIDGET_NON_LIVE_TYPES.has(type) && !!raw.live,
	}
	if (type === 'toggle' || type === 'boolean')
		v.value = v.value === 'true' ? 'true' : 'false'
	if (type === 'slider' || type === 'counter') {
		const min = Number(raw.min)
		const max = Number(raw.max)
		const step = Number(raw.step)
		if (Number.isFinite(min)) v.min = min
		if (Number.isFinite(max)) v.max = max
		if (Number.isFinite(step) && step > 0) v.step = step
	}
	if (type === 'dropdown' || type === 'checkboxes') {
		const options = cleanWidgetOptions(raw.options)
		if (options) v.options = options
	}
	return v
}

function cleanWidgetDefinition(raw) {
	if (!raw || typeof raw !== 'object') return null
	const id = typeof raw.id === 'string' ? raw.id.trim() : ''
	if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null
	const name = String(raw.name ?? '').trim().slice(0, 80)
	if (!name) return null
	const width = Math.min(3840, Math.max(20, Math.round(Number(raw.width) || 0)))
	const height = Math.min(2160, Math.max(20, Math.round(Number(raw.height) || 0)))
	const header = String(raw.header ?? '').slice(0, WIDGET_CODE_PART)
	const body = String(raw.body ?? '').slice(0, WIDGET_CODE_PART)
	const style = String(raw.style ?? '').slice(0, WIDGET_CODE_PART)
	const script = String(raw.script ?? '').slice(0, WIDGET_CODE_PART)
	if (header.length + body.length + style.length + script.length > WIDGET_CODE_TOTAL)
		return null
	const variables = []
	const seen = new Set()
	if (Array.isArray(raw.variables)) {
		for (const item of raw.variables.slice(0, 50)) {
			const v = cleanWidgetVariable(item)
			if (!v || seen.has(v.name)) continue
			seen.add(v.name)
			variables.push(v)
		}
	}
	const integrations = {}
	for (const key of WIDGET_TWITCH_INTEGRATIONS) {
		if (raw.integrations?.[key]) integrations[key] = true
	}
	return {
		id,
		name,
		description: raw.description
			? String(raw.description).slice(0, 200)
			: undefined,
		width,
		height,
		header,
		body,
		style,
		script,
		variables,
		integrations: Object.keys(integrations).length
			? integrations
			: undefined,
	}
}

function cleanWidgetValues(widget, raw) {
	const source = raw && typeof raw === 'object' ? raw : {}
	const out = {}
	for (const v of widget.variables || []) {
		const value = source[v.name]
		out[v.name] = String(value ?? v.value ?? '').slice(0, 5000)
	}
	return out
}

// комната без подключений столько не держится в памяти: сохраняем на диск и выгружаем.
// При следующем входе сервер поднимет её из файла
const ROOM_IDLE_EVICT_MS = 15 * 60 * 1000

// события, меняющие состояние комнаты: по ним помечаем комнату «грязной» и раз в
// несколько секунд пишем её на диск (перетаскивание не пишет файл на каждое движение)
const MUTATING_EVENTS = new Set([
	'element:add',
	'element:update',
	'element:move',
	'element:resize',
	'element:delete',
	'element:reorder',
	'element:zorder-set',
	'groups:update',
	'elements:group',
	'draw:add',
	'draw:remove',
	'draw:clear',
	'playlist:step',
	'widget:save',
	'widget:delete',
	'element:toggle-visible',
	'timer:start',
	'timer:pause',
	'timer:reset',
	'elements:clear',
])

// порядок участников в списке «кто на странице»: стример, модераторы, оверлей
const ROLE_RANK = { streamer: 0, moderator: 1, guest: 2 }

// Доступ в админ-панель (см. lib/admin.ts — список должен совпадать)
const DEFAULT_ADMINS = ['jettle_', 'nezory_1']
function adminLogins() {
  const raw = process.env.ADMIN_LOGINS
  return (raw ? raw.split(',') : DEFAULT_ADMINS).map(s => s.trim().toLowerCase()).filter(Boolean)
}
const isAdminLogin = login => !!login && adminLogins().includes(login.toLowerCase())

// Последние действия по комнатам (для админки): кто что менял и когда
const recentEvents = []
function noteEvent(room, login, event) {
  recentEvents.push({ at: Date.now(), room: String(room).slice(0, 8), login, event })
  if (recentEvents.length > 120) recentEvents.splice(0, recentEvents.length - 120)
}

// как часто сбрасывать изменения комнат на диск
// 20 секунд вместо 5: большая комната перезаписывается реже, WAL и I/O спокойнее.
// Потерять при аварии максимум последние 20 секунд правок — приемлемо.
const ROOM_FLUSH_MS = 20000

// проверка cookie-сессии (payload.sig, как в lib/session.ts). Логин из query больше
// не считается доказательством: иначе отозванный модератор мог переподключиться
// без ?login= и остаться «гостем» с правом менять оверлей
function sessionFromCookie(cookieHeader) {
	const m = /(?:^|;\s*)sc_session=([^;]+)/.exec(cookieHeader || '')
	if (!m) return null
	let raw = m[1]
	try {
		raw = decodeURIComponent(raw)
	} catch {}
	const dot = raw.lastIndexOf('.')
	if (dot <= 0) return null
	const payload = raw.slice(0, dot)
	const sig = raw.slice(dot + 1)
	const expected = crypto
		.createHmac('sha256', sessionSecret())
		.update(payload)
		.digest('base64url')
	const a = Buffer.from(sig)
	const b = Buffer.from(expected)
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
		return data && typeof data.login === 'string' && data.login ? data : null
	} catch {
		return null
	}
}

app.prepare().then(() => {
	const server = createServer((req, res) => {
		handle(req, res)
	})

	const io = new Server(server, {
		maxHttpBufferSize: 50 * 1024 * 1024,
		// Пускаем только соединения со своего origin: чужой сайт не должен открывать
		// сокет к панели (гостям и так доступно только чтение, но зачем лишний канал).
		// Свой origin всегда совпадает с Host, поэтому панель/оверлей/OBS проходят.
		// Если за прокси Host подменяется — можно отключить проверку: TRUST_ANY_ORIGIN=1
		allowRequest: (req, cb) => {
			if (process.env.TRUST_ANY_ORIGIN === '1') return cb(null, true)
			const origin = req.headers.origin
			if (!origin) return cb(null, true) // не браузер: тесты, нативные клиенты
			try {
				const ok = new URL(origin).host === req.headers.host
				if (!ok)
					console.log('[io] отклоняю соединение с чужого origin:', origin, 'host:', req.headers.host)
				return cb(null, ok)
			} catch {
				return cb(null, false)
			}
		},
		cors: { origin: '*', methods: ['GET', 'POST'] },
	})

	// комнаты: у каждой ссылки (?room=токен) своё независимое состояние;
	// прямой доступ без ?room= попадает в общую комнату "default"
	const rooms = new Map() // key -> { key, state, lastActivity, locks, dirty }

	// OBS-мост (прототип): последнее состояние OBS по комнате и id сокета моста.
	// Только память, на диск не пишется: при перезапуске мост пришлёт состояние сам.
	const obsRooms = new Map() // room -> { bridgeId, state }
	// сокеты, которые смотрят/управляют OBS: при отзыве права их выкидываем сразу
	const obsViews = new Map() // socket.id -> { room, login, allowed }

	const liveSockets = key => io.sockets.adapter.rooms.get(key)?.size ?? 0

	// записать комнату на диск, если есть несохранённые изменения
	async function persist(r) {
		if (!r || !r.dirty) return
		if (await roomStore.saveRoom(roomsDir(), r.key, r.state)) r.dirty = false
	}

	// пустые комнаты (без подключений и без элементов) можно удалять сразу —
	// терять нечего, файл на диске тоже убираем
	async function dropEmptyRooms() {
		for (const [key, r] of rooms) {
			if (liveSockets(key) === 0 && r.state.elements.length === 0) {
				rooms.delete(key)
				await roomStore.deleteRoom(roomsDir(), key)
			}
		}
	}

	// вытеснение при достижении лимита: сначала пустые, затем самые давние без
	// подключений — их состояние сначала сохраняем, чтобы не потерять элементы
	async function evictRooms() {
		await dropEmptyRooms()
		if (rooms.size < MAX_ROOMS) return
		const stale = [...rooms.entries()]
			.filter(([key]) => liveSockets(key) === 0)
			.sort((a, b) => a[1].lastActivity - b[1].lastActivity)
		for (const [key, r] of stale) {
			if (rooms.size < MAX_ROOMS) break
			await persist(r)
			rooms.delete(key)
			console.log('[ovrly] комната вытеснена из памяти (лимит комнат):', key.slice(0, 12))
		}
	}

	// сколько примерно занимают все комнаты в памяти
	function totalRoomBytes() {
		let total = 0
		for (const r of rooms.values()) total += roomStore.roomBytes(r.state)
		return total
	}

	// общий предохранитель: если все комнаты вместе превысили лимит, выгружаем
	// самые давние из тех, где нет подключений. Активные комнаты не трогаем
	async function trimMemory() {
		let total = totalRoomBytes()
		if (total <= MAX_TOTAL_ROOM_BYTES) return
		const idle = [...rooms.entries()]
			.filter(([key]) => liveSockets(key) === 0)
			.sort((a, b) => a[1].lastActivity - b[1].lastActivity)
		for (const [key, r] of idle) {
			if (total <= MAX_TOTAL_ROOM_BYTES) break
			await persist(r)
			total -= roomStore.roomBytes(r.state)
			rooms.delete(key)
			console.log('[ovrly] комната выгружена из памяти (общий лимит):', key.slice(0, 12))
		}
	}

	async function getRoom(key) {
		let r = rooms.get(key)
		if (r) return r
		if (rooms.size >= MAX_ROOMS) await evictRooms()
		// состояние поднимаем из БД или с диска: элементы переживают рестарт сервера
		let saved = await roomStore.loadRoom(roomsDir(), key)
		let restoredFromJson = false
		// переходная страховка: если комнаты ещё нет в БД (или БД временно недоступна),
		// поднимаем JSON-файл и помечаем комнату на сохранение в Postgres.
		// После cutover можно выключить через ROOMS_JSON_FALLBACK=0.
		if (!saved && process.env.DATABASE_URL && process.env.ROOMS_JSON_FALLBACK !== '0') {
			saved = roomStore.loadRoomJson(roomsDir(), key)
			restoredFromJson = !!saved
			if (saved) {
				console.log(
					'[ovrly] комната поднята из JSON fallback:',
					key.slice(0, 12),
					'элементов:',
					saved.elements.length,
				)
			}
		}
		r = {
			key,
			state: saved ?? { elements: [], canvasW: CANVAS_W, canvasH: CANVAS_H },
			lastActivity: Date.now(),
			locks: new Map(), // id элемента -> { socketId, login, until }
			users: new Map(), // socketId -> { login, role } — кто сейчас на странице
			dirty: restoredFromJson,
		}
		// старые комнаты могли сохранить groupId как строку "null"
		let cleaned = false
		for (const el of r.state.elements || [])
			if (el.groupId === 'null' || el.groupId === '') {
				delete el.groupId
				cleaned = true
			}
		if (cleaned) r.dirty = true
		rooms.set(key, r)
		if (saved && !restoredFromJson) {
			console.log(
				'[ovrly] комната восстановлена:',
				key.slice(0, 12),
				'элементов:',
				saved.elements.length,
			)
		}
		return r
	}

	// периодика: чистим просроченные локи и пустые комнаты. Комнаты с элементами
	// не теряются: сначала сохраняются, потом выгружаются из памяти
	let maintenanceRunning = false
	setInterval(async () => {
		if (maintenanceRunning) return
		maintenanceRunning = true
		try {
			const now = Date.now()
			for (const [key, r] of rooms) {
				for (const [id, lock] of r.locks) if (lock.until < now) r.locks.delete(id)
				if (liveSockets(key) !== 0) continue
				if (r.state.elements.length === 0) {
					rooms.delete(key)
					await roomStore.deleteRoom(roomsDir(), key)
				} else if (now - r.lastActivity > ROOM_IDLE_EVICT_MS) {
					await persist(r)
					rooms.delete(key)
					console.log('[ovrly] комната выгружена из памяти (простой):', key.slice(0, 12))
				}
			}
			await trimMemory()
		} finally {
			maintenanceRunning = false
		}
	}, 60 * 1000)

	// сброс изменений комнат (не чаще раза в ROOM_FLUSH_MS на комнату)
	let flushRunning = false
	setInterval(async () => {
		if (flushRunning) return
		flushRunning = true
		try {
			for (const r of rooms.values()) await persist(r)
		} finally {
			flushRunning = false
		}
	}, ROOM_FLUSH_MS)

	// аккуратное завершение: дописываем комнаты, чтобы Ctrl+C не терял последние правки
	let shuttingDown = false
	const shutdown = async signal => {
		if (shuttingDown) return
		shuttingDown = true
		let n = 0
		for (const r of rooms.values()) {
			if (r.dirty) {
				await persist(r)
				n++
			}
		}
		console.log(`[ovrly] выключение (${signal}): сохранено комнат — ${n}`)
		process.exit(0)
	}
	process.on('SIGINT', () => {
		void shutdown('SIGINT')
	})
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM')
	})

	// Ссылки и доступы живут в Postgres (или JSON локально). Держим снимок в памяти:
	// middleware сокетов должен проверять доступ синхронно, без запроса на каждое движение
	const storage = require('./lib/storage')
	let access = { at: 0, links: new Map(), invites: new Map() }
	async function refreshAccess(force = false) {
		if (!force && Date.now() - access.at < 2000) return
		try {
			const [links, invites] = await Promise.all([
				storage.getLinks(),
				storage.getAllInvites(),
			])
			const linksByToken = new Map()
			for (const link of links) {
				if (link.token) linksByToken.set(link.token, link.login)
			}
			const invitesByOwner = new Map()
			for (const invite of invites) {
				let mods = invitesByOwner.get(invite.owner)
				if (!mods) {
					mods = new Map()
					invitesByOwner.set(invite.owner, mods)
				}
				mods.set(invite.moderator, invite)
			}
			access = { at: Date.now(), links: linksByToken, invites: invitesByOwner }
			syncObsViews()
		} catch (e) {
			console.error('[ovrly] не удалось обновить доступы:', e.message)
		}
	}

	// смена права в кабинете применяется сразу: доступ отобрали — вкладка гаснет,
	// вернули — снова включается, без перезагрузки страницы
	function syncObsViews() {
		for (const [id, rec] of obsViews) {
			const socket = io.sockets.sockets.get(id)
			if (!socket) {
				obsViews.delete(id)
				continue
			}
			const ok = hasObsAccess(rec.room, rec.login)
			if (ok === rec.allowed) continue
			rec.allowed = ok
			if (ok) {
				socket.join(`obs:${rec.room}`)
				socket.emit('obs:access', { allowed: true })
			} else {
				socket.leave(`obs:${rec.room}`)
				socket.emit('obs:access', { allowed: false })
			}
		}
	}
	refreshAccess(true)
	setInterval(() => refreshAccess(true), 2000)

	function roomOwner(token) {
		return access.links.get(token) || null
	}
	// приглашение должно быть accepted и не suspended; кэш обновляется раз в 2 секунды
	function hasPanelAccess(room, login) {
		const owner = roomOwner(room)
		if (!owner) return false // комната без владельца — панель не отдаём
		if (login.toLowerCase() === owner.toLowerCase()) return true // стример — всегда
		const entry = access.invites.get(owner)?.get(login)
		return !!entry && entry.status === 'accepted' && !entry.suspended
	}
	// право управлять OBS: владелец всегда, модератор — если включено в кабинете
	function hasObsAccess(room, login) {
		const owner = roomOwner(room)
		if (!owner) return false
		if (login.toLowerCase() === owner.toLowerCase()) return true
		const entry = access.invites.get(owner)?.get(login)
		return !!entry && entry.status === 'accepted' && !entry.suspended && entry.obs !== 'none'
	}

	// ===== Twitch-события для виджетов =====
	// Один анонимный IRC-клиент на комнату, только если в комнате есть виджет
	// с любой включённой интеграцией Twitch. В сам виджет токены не попадают.
	const twitchChats = new Map()

	function parseIrcLine(line) {
		let rest = line
		const tags = {}
		if (rest.startsWith('@')) {
			const space = rest.indexOf(' ')
			if (space < 0) return null
			for (const part of rest.slice(1, space).split(';')) {
				const eq = part.indexOf('=')
				if (eq > 0) tags[part.slice(0, eq)] = part.slice(eq + 1)
			}
			rest = rest.slice(space + 1)
		}
		let prefix = ''
		if (rest.startsWith(':')) {
			const space = rest.indexOf(' ')
			if (space < 0) return null
			prefix = rest.slice(1, space)
			rest = rest.slice(space + 1)
		}
		const space = rest.indexOf(' ')
		const command = space < 0 ? rest : rest.slice(0, space)
		const params = space < 0 ? '' : rest.slice(space + 1)
		return { tags, prefix, command, params }
	}

	function ircDecode(s) {
		return String(s || '')
			.replace(/\\s/g, ' ')
			.replace(/\\:/g, ';')
			.replace(/\\r/g, '\r')
			.replace(/\\n/g, '\n')
			.replace(/\\\\/g, '\\')
	}

	function parseTwitchMessage(line, channel) {
		const parsed = parseIrcLine(line)
		if (!parsed || parsed.command !== 'PRIVMSG') return null
		const { tags, prefix, params } = parsed
		const textAt = params.indexOf(' :')
		if (textAt < 0) return null
		let message = params.slice(textAt + 2)
		if (message.length > 1000) message = message.slice(0, 1000)
		const login = (prefix.split('!')[0] || '').toLowerCase()
		let isAction = false
		if (message.startsWith('\x01ACTION ')) {
			isAction = true
			message = message.slice(8).replace(/\x01$/g, '')
		}
		const badges = (tags.badges || '')
			.split(',')
			.filter(Boolean)
			.map(item => {
				const [type, version] = item.split('/')
				return { type, text: type, version }
			})
		return {
			username: ircDecode(tags['display-name'] || login),
			login,
			message,
			isAction,
			color: tags.color || '',
			badges,
			userId: tags['user-id'] || '',
			bits: Number(tags.bits) || 0,
			isBroadcaster: login === channel,
			isMod: tags.mod === '1',
			isVip: tags.vip === '1',
			isSubscriber: tags.subscriber === '1',
			raw: { tags },
		}
	}

	// USERNOTICE: подписки, подарочные сабы, рейды. Приходит на тот же
	// анонимный IRC-клиент (CAP twitch.tv/commands), авторизация не нужна.
	function parseTwitchUserNotice(line, channel) {
		const parsed = parseIrcLine(line)
		if (!parsed || parsed.command !== 'USERNOTICE') return null
		const { tags, prefix, params } = parsed
		const msgId = String(tags['msg-id'] || '')
		if (!msgId) return null
		const login = (
			tags.login ||
			prefix.split('!')[0] ||
			''
		).toLowerCase()
		const username = ircDecode(tags['display-name'] || login) || 'anonymous'
		const systemMessage = ircDecode(tags['system-msg'] || '')
		const textAt = params.indexOf(' :')
		const message =
			textAt >= 0 ? ircDecode(params.slice(textAt + 2)).slice(0, 500) : ''
		const months =
			Number(tags['msg-param-cumulative-months']) ||
			Number(tags['msg-param-months']) ||
			0
		const streak = Number(tags['msg-param-streak-months']) || 0
		const tier = tags['msg-param-sub-plan'] || ''
		const giftCount = Number(tags['msg-param-mass-gift-count']) || 1
		const recipientLogin = (
			tags['msg-param-recipient-user-name'] || ''
		).toLowerCase()
		const recipient = ircDecode(
			tags['msg-param-recipient-display-name'] || recipientLogin,
		)
		switch (msgId) {
			case 'sub':
			case 'resub':
				return {
					event: 'sub',
					data: {
						kind: msgId,
						username,
						login,
						months,
						streak,
						tier,
						message,
						isGift: false,
						systemMessage,
					},
				}
			case 'subgift':
			case 'anonsubgift':
				return {
					event: 'sub',
					data: {
						kind: 'gift',
						username: recipient || 'anonymous',
						login: recipientLogin,
						gifter: username,
						recipient: recipient || 'anonymous',
						months,
						tier,
						giftCount: 1,
						isGift: true,
						message,
						systemMessage,
					},
				}
			case 'submysterygift':
				return {
					event: 'sub',
					data: {
						kind: 'gift-bomb',
						username,
						login,
						gifter: username,
						months,
						tier,
						giftCount,
						isGift: true,
						message,
						systemMessage,
					},
				}
			case 'raid':
				return {
					event: 'raid',
					data: {
						kind: 'raid',
						username,
						login,
						viewers: Number(tags['msg-param-viewerCount']) || 0,
						systemMessage,
					},
				}
			default:
				return null
		}
	}

	function stopTwitchChat(room) {
		const chat = twitchChats.get(room)
		if (!chat) return
		chat.closed = true
		if (chat.retry) clearTimeout(chat.retry)
		try {
			chat.ws?.close()
		} catch {}
		twitchChats.delete(room)
	}

	function startTwitchChat(room, channel, force = false) {
		const current = twitchChats.get(room)
		if (!force && current && current.channel === channel && !current.closed)
			return
		stopTwitchChat(room)
		const chat = { channel, ws: null, retry: null, closed: false }
		twitchChats.set(room, chat)

		const connect = () => {
			if (chat.closed) return
			let ws
			try {
				ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
			} catch {
				chat.retry = setTimeout(connect, 5000)
				return
			}
			chat.ws = ws
			ws.on('open', () => {
				const nick = `justinfan${Math.floor(10000 + Math.random() * 80000)}`
				ws.send('PASS SCHMOOPIIE')
				ws.send(`NICK ${nick}`)
				ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
				ws.send(`JOIN #${channel}`)
				console.log('[twitch] события подключены:', channel, 'комната:', room.slice(0, 12))
			})
			ws.on('message', data => {
				const text = data.toString()
				for (const line of text.split('\r\n')) {
					if (!line) continue
					if (line.startsWith('PING')) {
						try {
							ws.send('PONG :tmi.twitch.tv')
						} catch {}
						continue
					}
					const msg = parseTwitchMessage(line, channel)
					if (msg) {
						io.to(room).emit('widget:chat', msg)
						if (msg.bits > 0) {
							io.to(room).emit('widget:twitch-event', {
								event: 'bits',
								data: {
									username: msg.username,
									login: msg.login,
									amount: msg.bits,
									message: msg.message,
									color: msg.color,
									badges: msg.badges,
								},
							})
						}
						continue
					}
					const twitchEvent = parseTwitchUserNotice(line, channel)
					if (twitchEvent)
						io.to(room).emit('widget:twitch-event', twitchEvent)
				}
			})
			ws.on('close', () => {
				if (chat.closed) return
				chat.retry = setTimeout(connect, 3000)
			})
			ws.on('error', () => {})
		}
		connect()
	}

	function roomNeedsTwitchChat(state) {
		return (state?.elements || []).some(el => {
			if (el.type !== 'widget') return false
			const i = el.widget?.integrations
			return !!(
				i?.twitchChat ||
				i?.twitchSubs ||
				i?.twitchRaids ||
				i?.twitchBits
			)
		})
	}

	function syncTwitchChat(room, state) {
		const owner = roomOwner(room)
		if (!owner || !roomNeedsTwitchChat(state)) {
			stopTwitchChat(room)
			return
		}
		startTwitchChat(room, owner.toLowerCase())
	}


	const adminSockets = new Set()

	// Статистика для админ-панели: комнаты, участники, активность, память
	function adminStats() {
		const mem = process.memoryUsage()
		const now = Date.now()
		const roomsOut = []
		let elements = 0
		let bytes = 0
		// уникальные люди (без оверлеев) — Set глобально: один человек в двух комнатах считается один раз
		const peopleLogins = new Set()
		let sockets = 0
		for (const [key, r] of rooms) {
			const owner = roomOwner(key)
			// Один и тот же ник может держать несколько вкладок (панель, оверлей) — схлопываем
			// в одну строку с числом подключений, иначе в списке «кто на сайте» плодятся дубликаты
			const byLogin = new Map()
			for (const u of r.users.values()) {
				const seenSec = Math.round((now - (u.lastSeen || now)) / 1000)
				const connectedSec = Math.round((now - (u.connectedAt || now)) / 1000)
				const cur = byLogin.get(u.login)
				if (cur) {
					cur.connections += 1
					if (seenSec < cur.seenSec) cur.seenSec = seenSec
					if (connectedSec < cur.connectedSec) cur.connectedSec = connectedSec
				} else {
					byLogin.set(u.login, {
						login: u.login,
						role: u.role,
						seenSec,
						connectedSec,
						connections: 1,
					})
				}
				if (u.role !== 'guest') peopleLogins.add(u.login.toLowerCase())
			}
			const users = [...byLogin.values()].sort(
				(a, b) =>
					ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.login.localeCompare(b.login),
			)
			const elev = r.state.elements.length
			const byt = roomStore.roomBytes(r.state)
			elements += elev
			bytes += byt
			sockets += r.users.size
			roomsOut.push({
				key: String(key).slice(0, 12),
				// полный токен комнаты нужен админке для кнопки невидимого входа;
				// статистика отдаётся только администраторам
				token: String(key),
				owner: owner || '—',
				elements: elev,
				bytesMB: Math.round((byt / 1024 / 1024) * 10) / 10,
					sockets: r.users.size,
				dirty: !!r.dirty,
				lastActivitySec: Math.round((now - r.lastActivity) / 1000),
				lastEditSec: r.lastEditAt ? Math.round((now - r.lastEditAt) / 1000) : null,
				edits: r.edits || 0,
				users,
			})
		}
		roomsOut.sort((x, y) => x.lastActivitySec - y.lastActivitySec)
		const fiveMinAgo = now - 5 * 60 * 1000
		return {
			now,
			uptimeSec: Math.round(process.uptime()),
			memory: { rssMB: Math.round(mem.rss / 1024 / 1024), heapMB: Math.round(mem.heapUsed / 1024 / 1024) },
			dataDir: dataDir(),
			totals: {
				rooms: rooms.size,
				elements,
				bytesMB: Math.round((bytes / 1024 / 1024) * 10) / 10,
				sockets,
				people: peopleLogins.size,
				admins: [...adminSockets].length,
			},
			activity: {
				actions5m: recentEvents.filter(e => e.at > fiveMinAgo).length,
				edits5m: recentEvents.filter(e => e.at > fiveMinAgo && MUTATING_EVENTS.has(e.event)).length,
				lastAt: recentEvents.length ? recentEvents[recentEvents.length - 1].at : null,
			},
			rooms: roomsOut,
		}
	}
	const pushStats = () => {
		if (!adminSockets.size) return
		const data = adminStats()
		for (const id of adminSockets) io.to(id).emit('admin:stats', data)
	}
	setInterval(pushStats, 5000)

	io.on('connection', async socket => {
		// новый линк/инвайт должен применяться сразу, а не ждать периодического обновления
		await refreshAccess(true)
		// комната из handshake (?room=токен), иначе общая default-комната
		const room = ((socket.handshake.query.room || 'default') + '').slice(0, 64)
		socket.join(room)
		// отдельная комната для OBS: только стример и модераторы с правом
		const obsRoom = `obs:${room}`

		const roomRec = await getRoom(room)
		const state = roomRec.state

		socket.emit('state:init', state)

		// личность берём из подписанной cookie: панель всегда её отправляет (same-origin),
		// у оверлея в OBS cookie нет — он гость и работает только на чтение
		const session = sessionFromCookie(socket.handshake.headers.cookie)
		const userLogin = session ? session.login : 'гость'
		const isGuest = !session
		const ownerByRoom = roomOwner(room)
		// если в комнате есть виджет с Twitch-чатом — поднимаем IRC-релей
		syncTwitchChat(room, state)
		// стример (владелец комнаты) может перехватывать элементы у модераторов всегда
		const isStreamer =
			!isGuest && !!ownerByRoom && userLogin.toLowerCase() === ownerByRoom.toLowerCase()
		// невидимый вход разрешён только администраторам (jettle_/nezory_1). Проверяем
		// ник из подписанной cookie, а не только параметр URL: иначе ссылка с ?invisible=1
		// дала бы любому скрытый доступ к чужой комнате
		const isGhost =
			!isGuest && socket.handshake.query.invisible === '1' && isAdminLogin(userLogin)
		// админ-невидимка может войти в любую комнату без приглашения
		const hasAccess = isGhost || (!isGuest && hasPanelAccess(room, userLogin))

		// ===== OBS: мост и управление =====
		// В панели без ссылок и ключей: владелец комнаты (стример) сам становится
		// мостом, а модератор с доступом к комнате сразу получает управление.
		// Ключ из obs_access остался только для внешнего дока на ПК стримера.
		const qkey = String(socket.handshake.query.key || '')
		const wantsBridge = socket.handshake.query.obsbridge === '1'
		const wantsControl = socket.handshake.query.obscontrol === '1'
		const obsKeyOk =
			(wantsBridge || wantsControl) && qkey ? await obsAccess.verify(room, qkey) : false
		const canBridge = obsKeyOk || isStreamer || isGhost
		const canControl =
			obsKeyOk || isGhost || isStreamer || (!isGuest && hasObsAccess(room, userLogin))
		if ((wantsBridge && !canBridge) || (wantsControl && !canControl)) {
			socket.emit('obs:denied')
			return
		}
		const isObsBridge = wantsBridge
		const isObsControl = wantsControl
		if (isObsBridge) {
			// мостов на комнату может быть несколько (две вкладки панели, док OBS):
			// команды уходят любому живому, при закрытии одного остальные работают
			let rec = obsRooms.get(room)
			if (!rec) {
				rec = { bridges: new Set(), state: null }
				obsRooms.set(room, rec)
			}
			rec.bridges.add(socket.id)
			socket.join(obsRoom)
			console.log('[obs] мост подключён, room:', room.slice(0, 12), 'как', userLogin)
			io.to(obsRoom).emit('obs:presence', { online: true })
			socket.emit('obs:ready')
			if (rec.state) socket.emit('obs:state', rec.state)
			socket.on('obs:state', data => {
				if (!data || typeof data !== 'object') return
				// защита от «раздутого» состояния: один кадр не должен съесть память
				let raw = ''
				try {
					raw = JSON.stringify(data)
				} catch {
					return
				}
				if (raw.length > 256 * 1024) {
					console.log('[obs] состояние больше 256 КБ, пропускаю:', raw.length)
					return
				}
				rec.state = data
				socket.broadcast.to(obsRoom).emit('obs:state', data)
			})
			// метры не кэшируем: это поток, зритель получает только «сейчас»
			socket.on('obs:meters', data => {
				if (!data || typeof data !== 'object') return
				let raw = ''
				try {
					raw = JSON.stringify(data)
				} catch {
					return
				}
				if (raw.length > 32 * 1024) return
				socket.broadcast.to(obsRoom).emit('obs:meters', data)
			})
			socket.on('obs:result', data => {
				if (!data || typeof data !== 'object') return
				socket.broadcast.to(obsRoom).emit('obs:result', data)
			})
		socket.on('disconnect', () => {
				const cur = obsRooms.get(room)
				if (!cur || !cur.bridges.delete(socket.id)) return
				if (cur.bridges.size) return
				obsRooms.delete(room)
				io.to(obsRoom).emit('obs:presence', { online: false })
				console.log('[obs] мост отключён, room:', room.slice(0, 12))
			})
			return
		}

		// Админ-панель: служебное соединение (?admin=1) — комнату не занимает, только
		// статистика и предупреждение всех о деплое
		if (socket.handshake.query.admin === '1') {
			if (!isAdminLogin(userLogin)) {
				socket.emit('access:revoked')
				socket.disconnect(true)
				return
			}
			adminSockets.add(socket.id)
			console.log('[io] админ-панель подключена:', userLogin)
			socket.emit('admin:stats', adminStats())
			socket.on('admin:stats', () => socket.emit('admin:stats', adminStats()))
			socket.on('admin:announce', data => {
				const text = (data && typeof data.text === 'string' ? data.text : '').slice(0, 200)
				if (!text) return
				console.log('[io] объявление админа:', userLogin, '—', text)
				io.emit('server:notice', { text, at: Date.now() })
			})
			socket.on('disconnect', () => adminSockets.delete(socket.id))
			return
		}

		// сообщаем роль клиенту: панель без валидной сессии предупредит, что правки
		// не сохраняются (иначе действия молча отклонялись бы)
		socket.emit('access:role', {
			readOnly: !hasAccess,
			guest: isGuest,
			ghost: isGhost,
		})

		// клиент с ключом из obs_access (внешний док) не состоит в комнате, но
		// должен остаться на связи ради obs:cmd — это не доступ к панели
		const keyOnly = obsKeyOk && !hasAccess && !isStreamer && !isGhost

		if (!isGuest && !hasAccess && !keyOnly) {
			console.log('[io] доступ отозван, отключаю:', userLogin, 'room:', room.slice(0, 12))
			socket.emit('access:revoked')
			socket.disconnect(true)
			return
		}
		// участники комнаты: ник + роль (у оверлея в OBS сессии нет — он гость).
		// Список рассылаем всем в комнате при входе и выходе.
		// Невидимку в список не добавляем вовсе: он есть в комнате, но для всех —
		// его нет (и в статистике админки он тоже не появится)
		if (!isGhost && !keyOnly) {
			roomRec.users.set(socket.id, {
				login: isGuest ? 'Оверлей (OBS)' : userLogin,
				role: isGuest ? 'guest' : isStreamer ? 'streamer' : 'moderator',
				connectedAt: Date.now(),
				lastSeen: Date.now(),
			})
		}
		const buildUsers = () => {
			const byKey = new Map()
			for (const u of roomRec.users.values()) {
				// одинаковые ники (несколько вкладок одного человека) схлопываем со счётчиком
				const key = u.role === 'guest' ? '__guest__' : u.login
				const cur = byKey.get(key) ?? { login: u.login, role: u.role, connections: 0 }
				cur.connections += 1
				byKey.set(key, cur)
			}
			return [...byKey.values()].sort(
				(a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.login.localeCompare(b.login),
			)
		}
		const broadcastUsers = () => {
			io.to(room).emit('room:users', buildUsers())
		}
		if (isGhost) {
			// невидимка не входит в roomRec.users, но должен видеть остальных
			socket.emit('room:users', buildUsers())
		} else {
			broadcastUsers()
		}

		// ===== OBS: просмотр и управление =====
		// Смотреть может любой в комнате (гость — тоже), управлять — стример,
		// модератор с доступом или клиент с ключом прототипа.
		const obsAllowed =
			isObsControl || (!isGuest && (isStreamer || hasObsAccess(room, userLogin)))
		const obsNow = obsRooms.get(room)
		if (obsAllowed) socket.join(obsRoom)
		socket.emit('obs:presence', { online: !!obsNow })
		if (obsAllowed && obsNow?.state) socket.emit('obs:state', obsNow.state)
		if (obsAllowed) {
			obsViews.set(socket.id, { room, login: userLogin, allowed: true })
			socket.on('disconnect', () => obsViews.delete(socket.id))
			let cmdWin = 0
			let cmdCount = 0
			socket.on('obs:cmd', data => {
				// право проверяем на каждой команде: отзыв в кабинете действует сразу
				if (!hasObsAccess(room, userLogin) && !isStreamer && !isGhost && !obsKeyOk) {
					socket.emit('obs:access', { allowed: false })
					return
				}
				const now = Date.now()
				if (now - cmdWin > 1000) {
					cmdWin = now
					cmdCount = 0
				}
				if (++cmdCount > 30) return
				const cmd = cleanObsCmd(data)
				const rec = obsRooms.get(room)
				if (!cmd || !rec) {
					socket.emit('obs:result', {
						id: data && data.id,
						ok: false,
						error: rec ? 'команда отклонена' : 'OBS не подключён',
					})
					return
				}
				if (process.argv.includes('--dev'))
					console.log('[obs] cmd:', cmd.action, 'room:', room.slice(0, 12), 'от', userLogin)
				// право могло быть отозвано после подключения — проверяем каждый раз
				if (
					!obsKeyOk &&
					!isStreamer &&
					!isGhost &&
					!hasObsAccess(room, userLogin)
				) {
					socket.emit('obs:denied')
					return
				}
				const target = [...rec.bridges].pop()
				if (!target) {
					socket.emit('obs:result', {
						id: data && data.id,
						ok: false,
						error: 'OBS не подключён',
					})
					return
				}
				io.to(target).emit('obs:cmd', cmd)
			})
		}

		console.log(
			'[io] connect:',
			socket.id,
			'room:',
			room.slice(0, 12),
			'login:',
			userLogin,
			isGhost ? '(невидимый вход)' : '',
			isGuest ? '(гость, только чтение)' : '',
		)

		// любое событие от клиента считается активностью; здесь же проверяем доступ
		// (отзыв у модератора действует мгновенно) и помечаем комнату на сохранение
		socket.use((packet, next) => {
			const event = packet && packet[0]
			roomRec.lastActivity = Date.now()
			if (isGuest) {
				// оверлей — тоже гость, но именно он реально проигрывает YouTube
				// и должен иметь право переключить плейлист на следующий ролик
				if (event === 'playlist:step') {
					roomRec.dirty = true
					return next()
				}
				// клиент с ключом прототипа управляет OBS без cookie-сессии
				if (isObsControl && event === 'obs:cmd') return next()
				if (READ_ONLY_EVENTS.has(event)) return next()
				console.log('[io] гостю доступно только чтение, отклоняю:', event)
				return next(new Error('read-only'))
			}
			// курсоры — косметика: не гоняем проверку доступа на каждое движение мыши,
			// отзыв всё равно сработает на первом же действии
			if (event === 'cursor:move') return next()
			if (!isStreamer && !isGhost && !hasPanelAccess(room, userLogin)) {
				console.log('[io] доступ отозван на событии:', event, userLogin)
				socket.emit('access:revoked')
				socket.disconnect(true)
				return next(new Error('access revoked'))
			}
			if (MUTATING_EVENTS.has(event)) {
				roomRec.dirty = true
				roomRec.lastEditAt = Date.now()
				roomRec.edits = (roomRec.edits || 0) + 1
				noteEvent(room, userLogin, event)
			}
			const me = roomRec.users.get(socket.id)
			if (me) me.lastSeen = Date.now()
			next()
		})

		socket.on('cursor:move', data => {
			if (
				!data ||
				typeof data.x !== 'number' ||
				typeof data.y !== 'number' ||
				!isFinite(data.x) ||
				!isFinite(data.y)
			)
				return
			const x = Math.max(-100000, Math.min(100000, data.x))
			const y = Math.max(-100000, Math.min(100000, data.y))
			// курсор невидимки не рассылаем: иначе его ник всплывёт у всех на холсте
			if (isGhost) return
			socket.broadcast.to(room).emit('cursor:update', {
				id: socket.id,
				login: userLogin,
				x,
				y,
				hidden: !!data.hidden,
			})
		})

		// блокировка объекта: пока один тащит (или элемент у него выделен), другой
		// не может его перехватить. Лок живёт 5 секунд после последнего движения и
		// продлевается, пока элемент у владельца выделен.
		socket.on('element:grab', ({ id } = {}) => {
			if (!state.elements.some(e => e.id === id)) return
			const now = Date.now()
			const lock = roomRec.locks.get(id)
			const takenByOther =
				lock && lock.socketId !== socket.id && now < lock.until
			// Модератор чужой лок не перехватывает, а стример и админ-невидимка —
			// забирают: стример всегда главный в своей комнате.
			if (takenByOther && !isStreamer && !isGhost) {
				socket.emit('element:lock-denied', { id, by: lock.login })
				return
			}
			roomRec.locks.set(id, {
				socketId: socket.id,
				login: userLogin,
				until: now + 5000,
			})
			// ник невидимки не показываем: для остальных элемент просто «занят»
			io.to(room).emit('element:lock', {
				id,
				by: isGhost ? '' : userLogin,
				until: now + 5000,
			})
		})

		socket.on('disconnect', () => {
			io.to(room).emit('cursor:leave', { id: socket.id })
			roomRec.users.delete(socket.id)
			broadcastUsers()
			// снимаем локи отключившегося
			for (const [id, lock] of roomRec.locks) {
				if (lock.socketId === socket.id) {
					roomRec.locks.delete(id)
					io.to(room).emit('element:unlock', { id })
				}
			}
			if (liveSockets(room) === 0) stopTwitchChat(room)
		})

		// сняли выделение — сразу отдаём лок, не ждём таймаута
		socket.on('element:release', ({ id } = {}) => {
			const l = roomRec.locks.get(id)
			if (!l || l.socketId !== socket.id) return
			roomRec.locks.delete(id)
			io.to(room).emit('element:unlock', { id })
		})

		socket.on('element:add', el => {
			if (!el || typeof el !== 'object') return
			// свой звук таймера и звуковой элемент не должны разрастаться сверх лимита
			const soundBlob =
				el.type === 'audio' ? el.src : el.soundSrc
			if (soundBlob && String(soundBlob).length > MAX_SOUND_DATA) {
				console.log('[io] звук больше лимита, элемент не добавлен:', room.slice(0, 12))
				return
			}
			if (extraBytes(el) > MAX_ELEMENT_EXTRA) {
				console.log('[io] лишние поля элемента слишком большие:', room.slice(0, 12))
				return
			}
			// предохранитель по памяти: комната с тяжёлыми base64-файлами не должна
			// разрастись до OOM (это убило бы и её саму, и соседние комнаты).
			// Считаем с учётом нового элемента, а не только текущего размера.
			// Если id уже есть (отмена удаления), заменяем элемент, а не добавляем
			// второй: иначе Ctrl+Z раздувал комнату дублями.
			el.id = el.id || Date.now() + '-' + Math.random().toString(36).slice(2, 9)
			if (el.name !== undefined) el.name = String(el.name).slice(0, 80)
			if (el.groupId !== undefined) {
				const g = String(el.groupId).replace(/[^\w-]/g, '').slice(0, 40) || ''
				el.groupId = g && g !== 'null' ? g : undefined
			}
			const existing = state.elements.findIndex(e => e.id === el.id)
			if (existing < 0 && state.elements.length >= MAX_ELEMENTS) {
				console.log('[io] лимит элементов комнаты:', room.slice(0, 12))
				return
			}
			const current = roomStore.roomBytes(state)
			const withNew =
				current -
				(existing >= 0 ? roomStore.roomBytes({ elements: [state.elements[existing]] }) : 0) +
				roomStore.roomBytes({ elements: [el] })
			if (withNew > roomLimit(current)) {
				console.log(
					'[io] комната переполнена, элемент не добавлен:',
					room.slice(0, 12),
					'~',
					Math.round(withNew / 1024 / 1024),
					'МБ',
				)
				return
			}
			if (el.playlist !== undefined) {
				const playlist = cleanPlaylist(el.playlist)
				if (playlist) {
					el.playlist = playlist
					const i = Number(el.playlistIndex)
					el.playlistIndex = Number.isFinite(i)
						? Math.min(Math.max(0, Math.trunc(i)), playlist.length - 1)
						: 0
				} else {
					delete el.playlist
					delete el.playlistIndex
					delete el.playlistLoop
				}
			}
			if (el.type === 'widget') {
				const widget = cleanWidgetDefinition(el.widget)
				if (!widget) return
				el.widget = widget
				el.widgetValues = cleanWidgetValues(widget, el.widgetValues)
				const wv = Number(el.widgetVolume)
				el.widgetVolume = Number.isFinite(wv)
					? Math.min(100, Math.max(0, Math.round(wv)))
					: 100
			}
			if (el.type === 'draw' && !cleanDrawElement(el)) return
			if (el.type === 'telegram') {
				el.telegramChannel = cleanTelegramChannel(el.telegramChannel)
				el.telegramQr = el.telegramQr !== false
				el.telegramLight = !!el.telegramLight
				const d = Number(el.telegramDuration)
				el.telegramDuration = Number.isFinite(d)
					? Math.min(600, Math.max(3, Math.round(d)))
					: 15
				const u = Number(el.telegramUntil)
				el.telegramUntil = Number.isFinite(u) && u > 0 ? u : 0
			}
			el.zIndex = el.zIndex ?? state.elements.length
			el.visible = el.visible ?? true
			if ('crop' in el) el.crop = cleanCrop(el.crop)
			if (existing >= 0) state.elements[existing] = el
			else state.elements.push(el)
			io.to(room).emit('element:added', el)
			warnRoomLimit(io, roomRec, room, withNew)
			if (el.type === 'widget') syncTwitchChat(room, state)
			void trimMemory()
		})

		socket.on('element:update', partial => {
			if (!partial || typeof partial.id !== 'string') return
			const idx = state.elements.findIndex(e => e.id === partial.id)
			if (idx < 0) return
			const updLock = roomRec.locks.get(partial.id)
			if (
				updLock &&
				updLock.socketId !== socket.id &&
				updLock.until > Date.now() &&
				!isStreamer &&
				!isGhost &&
				// «показать сейчас» — команда, а не правка свойств
				partial.telegramUntil === undefined
			) {
				socket.emit('element:update-blocked', {
					id: partial.id,
					by: updLock.login,
				})
				return
			}
			const nextType = partial.type || state.elements[idx].type
			const soundBlob = nextType === 'audio' ? partial.src : partial.soundSrc
			if (soundBlob && String(soundBlob).length > MAX_SOUND_DATA) {
				console.log('[io] звук больше лимита, обновление отклонено:', room.slice(0, 12))
				return
			}
			const oldEl = state.elements[idx]
			if (partial.name !== undefined)
				partial.name = String(partial.name).slice(0, 80)
			if (partial.groupId !== undefined) {
				const g =
					String(partial.groupId).replace(/[^\w-]/g, '').slice(0, 40) || ''
				partial.groupId = g && g !== 'null' ? g : undefined
			}
			if (partial.widgetVolume !== undefined) {
				const wv = Number(partial.widgetVolume)
				partial.widgetVolume = Number.isFinite(wv)
					? Math.min(100, Math.max(0, Math.round(wv)))
					: undefined
			}
			if (partial.points !== undefined) {
				const merged = { ...oldEl, ...partial }
				if (!cleanDrawElement(merged)) return
				partial.points = merged.points
				partial.strokeColor = merged.strokeColor
				partial.strokeWidth = merged.strokeWidth
			}
			if (partial.telegramChannel !== undefined)
				partial.telegramChannel = cleanTelegramChannel(partial.telegramChannel)
			if (partial.telegramQr !== undefined) partial.telegramQr = !!partial.telegramQr
			if (partial.telegramLight !== undefined)
				partial.telegramLight = !!partial.telegramLight
			if (partial.telegramDuration !== undefined) {
				const d = Number(partial.telegramDuration)
				partial.telegramDuration = Number.isFinite(d)
					? Math.min(600, Math.max(3, Math.round(d)))
					: 15
			}
			if (partial.telegramUntil !== undefined) {
				const u = Number(partial.telegramUntil)
				partial.telegramUntil = Number.isFinite(u) && u > 0 ? u : 0
			}
			if (partial.widget !== undefined) {
				const widget = cleanWidgetDefinition(partial.widget)
				if (!widget) return
				partial.widget = widget
			}
			if (partial.widgetValues !== undefined) {
				const widget = partial.widget || oldEl.widget
				if (widget) partial.widgetValues = cleanWidgetValues(widget, partial.widgetValues)
				else delete partial.widgetValues
			}
			if (partial.playlist !== undefined) {
				const playlist = cleanPlaylist(partial.playlist)
				if (playlist) partial.playlist = playlist
				else {
					delete partial.playlist
					partial.playlistIndex = 0
				}
			}
			if (extraBytes(partial) > MAX_ELEMENT_EXTRA) {
				console.log('[io] лишние поля элемента слишком большие:', room.slice(0, 12))
				return
			}
			if ('crop' in partial) partial.crop = cleanCrop(partial.crop)
			if (
				oldEl.type === 'draw' &&
				!oldEl.drawW &&
				(partial.width !== undefined || partial.height !== undefined)
			) {
				partial.drawW = oldEl.width
				partial.drawH = oldEl.height
			}
			// медиа можно менять и через update: проверяем, что комната не переполнится
			if (partial.src !== undefined || partial.soundSrc !== undefined) {
				const before = roomStore.roomBytes({ elements: [oldEl] })
				const after = roomStore.roomBytes({ elements: [{ ...oldEl, ...partial }] })
				const cur = roomStore.roomBytes(state)
				if (cur - before + after > roomLimit(cur)) {
					console.log('[io] комната переполнена, обновление отклонено:', room.slice(0, 12))
					return
				}
			}
			state.elements[idx] = { ...oldEl, ...partial }
			socket.broadcast.to(room).emit('element:updated', state.elements[idx])
			if (partial.src !== undefined || partial.soundSrc !== undefined) {
				warnRoomLimit(io, roomRec, room, roomStore.roomBytes(state))
			}
			if (partial.widget !== undefined) syncTwitchChat(room, state)
		})

		socket.on('element:move', data => {
			const id = asId(data?.id)
			const x = asCoord(data?.x)
			const y = asCoord(data?.y)
			if (id === null || x === null || y === null) return
			const idx = state.elements.findIndex(e => e.id === id)
			if (idx >= 0) {
				const lock = roomRec.locks.get(id)
				const now = Date.now()
				if (lock && lock.socketId !== socket.id && now < lock.until) {
					if (!isStreamer && !isGhost)
						return // элемент тащит другой: правки отклоняем
					roomRec.locks.set(id, {
						socketId: socket.id,
						login: userLogin,
						until: now + 5000,
					})
					io.to(room).emit('element:lock', {
						id,
						by: isGhost ? '' : userLogin,
						until: now + 5000,
					})
				}
				const current = roomRec.locks.get(id)
				if (current && current.socketId === socket.id)
					current.until = now + 5000 // продлеваем лок, пока тащат
				state.elements[idx].x = x
				state.elements[idx].y = y
				socket.broadcast.to(room).emit('element:moved', { id, x, y })
			}
		})

		socket.on('element:resize', data => {
			const id = asId(data?.id)
			const width = asCoord(data?.width, 1, 100000)
			const height = asCoord(data?.height, 1, 100000)
			const x = data?.x === undefined ? null : asCoord(data.x)
			const y = data?.y === undefined ? null : asCoord(data.y)
			if (id === null || width === null || height === null) return
			if ((data.x !== undefined && x === null) || (data.y !== undefined && y === null)) return
			const idx = state.elements.findIndex(e => e.id === id)
			const cropProvided = data?.crop !== undefined
			const crop = cropProvided ? cleanCrop(data.crop) : null
			const pointsProvided = data?.points !== undefined
			const points = pointsProvided
				? cleanDrawPoints(data.points, width, height)
				: null
			const drawWProvided = typeof data?.drawW === 'number'
			const drawHProvided = typeof data?.drawH === 'number'
			const drawW = drawWProvided
				? Math.max(4, Math.min(8000, Number(data.drawW) || 4))
				: null
			const drawH = drawHProvided
				? Math.max(4, Math.min(8000, Number(data.drawH) || 4))
				: null
			if (idx >= 0) {
				const lock = roomRec.locks.get(id)
				const now = Date.now()
				if (lock && lock.socketId !== socket.id && now < lock.until) {
					if (!isStreamer && !isGhost)
						return // элемент тащит другой: правки отклоняем
					roomRec.locks.set(id, {
						socketId: socket.id,
						login: userLogin,
						until: now + 5000,
					})
					io.to(room).emit('element:lock', {
						id,
						by: isGhost ? '' : userLogin,
						until: now + 5000,
					})
				}
				const curResize = roomRec.locks.get(id)
				if (curResize && curResize.socketId === socket.id) {
					curResize.until = now + 5000
				}
				const el = state.elements[idx]
				if (pointsProvided && el.type === 'draw' && !points) return
				if (
					el.type === 'draw' &&
					!el.drawW &&
					(data.width !== undefined || data.height !== undefined)
				) {
					el.drawW = el.width
					el.drawH = el.height
				}
				if (x !== null) el.x = x
				if (y !== null) el.y = y
				el.width = width
				el.height = height
				if (drawWProvided && drawW !== null) el.drawW = drawW
				if (drawHProvided && drawH !== null) el.drawH = drawH
				if (pointsProvided && points) el.points = points
				if (cropProvided) el.crop = crop
				const flipProvided =
					typeof data?.flipH === 'boolean' || typeof data?.flipV === 'boolean'
				if (typeof data?.flipH === 'boolean') el.flipH = data.flipH
				if (typeof data?.flipV === 'boolean') el.flipV = data.flipV
				socket.broadcast.to(room).emit('element:resized', {
					id,
					x: el.x,
					y: el.y,
					width,
					height,
					...(cropProvided ? { crop } : {}),
					...(pointsProvided && points ? { points } : {}),
					...(drawWProvided && drawW !== null ? { drawW } : {}),
					...(drawHProvided && drawH !== null ? { drawH } : {}),
					...(flipProvided
						? { flipH: !!el.flipH, flipV: !!el.flipV }
						: {}),
				})
			}
		})

		socket.on('element:delete', id => {
			// Защита от удаления, пока элемент двигает кто-то другой
			const delLock = roomRec.locks.get(id)
			if (delLock && delLock.socketId !== socket.id && delLock.until > Date.now()) {
				socket.emit('element:delete-blocked', { id, by: delLock.login })
				return
			}
			state.elements = state.elements.filter(e => e.id !== id)
			roomRec.locks.delete(id)
			roomRec.dirty = true
			io.to(room).emit('element:deleted', id)
			syncTwitchChat(room, state)
		})

		socket.on('element:reorder', ({ id, direction } = {}) => {
			if (
				typeof id !== 'string' ||
				!['up', 'down', 'front', 'back'].includes(direction)
			)
				return
			// Слои считаем по zIndex, а не по порядку вставки: массив мог быть
			// перемешан (удаление, вставка, старые комнаты). Сначала нормализуем
			// 0..n-1, потом меняем местами соседние СЛОИ и снова нормализуем.
			const list = state.elements
				.slice()
				.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
			list.forEach((e, i) => {
				e.zIndex = i
			})
			const idx = list.findIndex(e => e.id === id)
			if (idx < 0) return
			if (direction === 'front') {
				list.push(list.splice(idx, 1)[0])
			} else if (direction === 'back') {
				list.unshift(list.splice(idx, 1)[0])
			} else {
				const to = direction === 'up' ? idx + 1 : idx - 1
				if (to < 0 || to >= list.length) return
				const tmp = list[idx]
				list[idx] = list[to]
				list[to] = tmp
			}
			list.forEach((e, i) => {
				e.zIndex = i
			})
			// порядок массива тоже выравниваем: новые элементы получают
			// zIndex = length и не должны оказаться под старыми
			state.elements = list
			io.to(room).emit(
				'element:zorder',
				list.map(e => e.id),
			)
		})

		socket.on('groups:update', raw => {
			const groups = cleanGroups(raw)
			state.groups = groups
			const ids = new Set(groups.map(g => g.id))
			for (const el of state.elements) {
				if (el.groupId && !ids.has(el.groupId)) delete el.groupId
			}
			io.to(room).emit('groups:updated', groups)
			roomRec.dirty = true
		})

		socket.on('elements:group', raw => {
			const ids = Array.isArray(raw?.ids)
				? raw.ids.filter(x => typeof x === 'string').slice(0, MAX_ELEMENTS)
				: []
			const groupId =
				typeof raw?.groupId === 'string'
					? raw.groupId.replace(/[^\w-]/g, '').slice(0, 40)
					: ''
			if (!groupId || !ids.length) return
			const set = new Set(ids)
			for (const el of state.elements)
				if (set.has(el.id)) el.groupId = groupId
			roomRec.dirty = true
			io.to(room).emit('elements:grouped', { ids, groupId })
		})

		// порядок слоёв целиком (перетаскивание в списке): ids снизу вверх
		socket.on('element:zorder-set', raw => {
			if (!Array.isArray(raw)) return
			const want = raw.filter(x => typeof x === 'string').slice(0, MAX_ELEMENTS)
			const byId = new Map(state.elements.map(e => [e.id, e]))
			const list = []
			for (const id of want) {
				const el = byId.get(id)
				if (el) {
					list.push(el)
					byId.delete(id)
				}
			}
			// всё, что не прислали, оставляем сверху в исходном порядке
			for (const el of byId.values()) list.push(el)
			list.forEach((e, i) => {
				e.zIndex = i
			})
			state.elements = list
			io.to(room).emit('element:zorder', list.map(e => e.id))
		})

		socket.on('draw:add', raw => {
			const s = cleanStroke(raw)
			if (!s) return
			state.strokes = Array.isArray(state.strokes) ? state.strokes : []
			state.strokes.push(s)
			if (state.strokes.length > MAX_STROKES) state.strokes.shift()
			io.to(room).emit('draw:added', s)
		})

		socket.on('draw:remove', id => {
			if (typeof id !== 'string' || !Array.isArray(state.strokes)) return
			const before = state.strokes.length
			state.strokes = state.strokes.filter(s => s.id !== id)
			if (state.strokes.length !== before) io.to(room).emit('draw:removed', id)
		})

		socket.on('draw:clear', () => {
			state.strokes = []
			io.to(room).emit('draw:cleared')
		})

		socket.on('widget:save', raw => {
			const def = cleanWidgetDefinition(raw)
			if (!def) return
			state.widgets = state.widgets || {}
			const old = state.widgets[def.id]
			const before = roomStore.roomBytes(state)
			state.widgets[def.id] = def
			const size = roomStore.roomBytes(state)
			if (size > roomLimit(before)) {
				if (old) state.widgets[def.id] = old
				else delete state.widgets[def.id]
				console.log('[io] виджет не сохранён: комната переполнена')
				return
			}
			io.to(room).emit('widget:updated', def)
			warnRoomLimit(io, roomRec, room, size)
		})

		socket.on('widget:delete', id => {
			if (typeof id !== 'string' || !state.widgets || !state.widgets[id]) return
			delete state.widgets[id]
			io.to(room).emit('widget:deleted', id)
		})

		// кнопка виджета: не меняет состояние, но должна дойти до iframe
		// на всех панелях и оверлее. Значение берём из определения, а не с клиента
		socket.on('widget:trigger', data => {
			const el = state.elements.find(e => e.id === data?.id)
			if (!el || el.type !== 'widget' || !el.widget) return
			const v = el.widget.variables?.find(
				x => x.name === data.name && x.type === 'button',
			)
			if (!v) return
			io.to(room).emit('widget:trigger', {
				id: el.id,
				name: v.name,
				value: String(v.value ?? ''),
			})
		})

		socket.on('playlist:step', data => {
			const idx = state.elements.findIndex(e => e.id === data?.id)
			if (idx < 0) return
			const el = state.elements[idx]
			const list = Array.isArray(el.playlist) ? el.playlist : []
			if (!list.length) return
			const dir = data?.dir === -1 ? -1 : 1
			const cur = Number.isInteger(el.playlistIndex) ? el.playlistIndex : 0
			if (data?.expected !== undefined && cur !== data.expected) return
			let next = cur + dir
			if (next < 0 || next >= list.length) {
				if (!el.playlistLoop) return
				next = (next + list.length) % list.length
			}
			el.playlistIndex = next
			el.src = `https://www.youtube.com/watch?v=${list[next]}`
			io.to(room).emit('element:updated', el)
		})

		socket.on('element:toggle-visible', id => {
			const idx = state.elements.findIndex(e => e.id === id)
			if (idx >= 0) {
				state.elements[idx].visible = !state.elements[idx].visible
				socket.broadcast.to(room).emit('element:updated', state.elements[idx])
			}
		})

		socket.on('timer:start', data => {
			if (!data || asId(data.id) === null) return
			const idx = state.elements.findIndex(e => e.id === data.id)
			if (idx >= 0) {
				const el = state.elements[idx]
				// закончившийся обратный отсчёт считается остановленным: кнопка в
				// панели уже показывает «Старт», и нажатие должно запустить заново
				const finished =
					el.timerDirection === 'down' &&
					el.duration &&
					el.startTime &&
					Date.now() - el.startTime >= el.duration * 1000
				if (el.isRunning && !finished) return
				let elapsed = el.elapsed || 0
				if (
					finished ||
					(el.timerDirection === 'down' &&
						el.duration &&
						elapsed >= el.duration * 1000)
				) {
					elapsed = 0
				}
				el.startTime = Date.now() - elapsed
				el.isRunning = true
				io.to(room).emit('element:updated', el)
			}
		})

		socket.on('timer:pause', data => {
			if (!data || asId(data.id) === null) return
			const idx = state.elements.findIndex(e => e.id === data.id)
			if (idx >= 0) {
				const el = state.elements[idx]
				if (el.isRunning && el.startTime) {
					el.elapsed = Date.now() - el.startTime
				}
				el.isRunning = false
				io.to(room).emit('element:updated', el)
			}
		})

		socket.on('timer:reset', data => {
			if (!data || asId(data.id) === null) return
			const idx = state.elements.findIndex(e => e.id === data.id)
			if (idx >= 0) {
				state.elements[idx].isRunning = false
				state.elements[idx].startTime = null
				state.elements[idx].elapsed = 0
				io.to(room).emit('element:updated', state.elements[idx])
			}
		})

		// команды медиа-плееру из панели (плей/пауза/перемотка/звук/субтитры)
		socket.on('element:command', data => {
			if (!data || typeof data.id !== 'string' || typeof data.cmd !== 'string') return
			socket.broadcast.to(room).emit('element:command', data)
		})

		// оверлей (пере)подключился — панель с выбранным играющим элементом отдаст состояние
		socket.on('overlay:hello', () => {
			socket.broadcast.to(room).emit('overlay:hello')
		})

		socket.on('elements:clear', () => {
			state.elements = []
			roomRec.locks.clear()
			io.to(room).emit('elements:cleared')
			syncTwitchChat(room, state)
		})
	})

	const port = process.env.PORT || 3000
	server.listen(port, () => {
		console.log('  ➜  Main:   http://localhost:' + port)
		console.log('  ➜  Panel:   http://localhost:' + port + '/panel')
		console.log('  ➜  Overlay: http://localhost:' + port + '/overlay')
		console.log('  ➜  Data:    ' + dataDir())
		console.log(
			'  ➜  Storage: ' +
				(process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON (data/)'),
		)
		console.log('  ➜  Rooms:   ' + roomsDir() + '\n')
	})
})
