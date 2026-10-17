const { createServer } = require('http')
const next = require('next')
const { Server } = require('socket.io')
const crypto = require('crypto')
const path = require('path')
const roomStore = require('./lib/roomStore')

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

// предел числа комнат: имя комнаты приходит из query и может быть любым, без лимита
// карта rooms росла бы бесконечно (каждая комната держит элементы своего стейта).
// При вытеснении комната сначала сохраняется на диск — вернётся, когда в неё зайдут снова
const MAX_ROOMS = 200

// предохранитель по памяти: медиа «с ПК» лежат в памяти как base64, одна комната
// не должна занять всю RAM сервера. Для хостинга ~2 ГБ 128 МБ на комнату —
// запас под несколько тяжёлых оверлеев
const MAX_ROOM_BYTES = 128 * 1024 * 1024

// общий предел памяти на все комнаты: при превышении выгружаем самые давние
// комнаты без подключений (их состояние остаётся на диске). 768 МБ оставляют
// около гигабайта под Node/Next, GC и временные копии при сохранении/рассылке
const MAX_TOTAL_ROOM_BYTES = 768 * 1024 * 1024

// свой звук таймера хранится в стейте как base64; 3 МБ base64 — примерно 2,2 МБ файла.
// Клиент ограничивает файл 2 МБ, сервер дополнительно не даёт залить больше
const MAX_SOUND_DATA = 3 * 1024 * 1024

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
const ROOM_FLUSH_MS = 5000

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
		} catch (e) {
			console.error('[ovrly] не удалось обновить доступы:', e.message)
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
		const roomRec = await getRoom(room)
		const state = roomRec.state

		socket.emit('state:init', state)

		// личность берём из подписанной cookie: панель всегда её отправляет (same-origin),
		// у оверлея в OBS cookie нет — он гость и работает только на чтение
		const session = sessionFromCookie(socket.handshake.headers.cookie)
		const userLogin = session ? session.login : 'гость'
		const isGuest = !session
		const ownerByRoom = roomOwner(room)
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

		if (!isGuest && !hasAccess) {
			console.log('[io] доступ отозван, отключаю:', userLogin, 'room:', room.slice(0, 12))
			socket.emit('access:revoked')
			socket.disconnect(true)
			return
		}
		// участники комнаты: ник + роль (у оверлея в OBS сессии нет — он гость).
		// Список рассылаем всем в комнате при входе и выходе.
		// Невидимку в список не добавляем вовсе: он есть в комнате, но для всех —
		// его нет (и в статистике админки он тоже не появится)
		if (!isGhost) {
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

		// блокировка объекта на время перетаскивания: пока один тащит, другой перехватить не может;
		// лок живёт 5 секунд после последнего движения (после остановки — ещё 5 секунд и свободно).
		// Исключение — стример: берёт элемент всегда, лок переходит к нему
		socket.on('element:grab', ({ id } = {}) => {
			if (!state.elements.some(e => e.id === id)) return
			const now = Date.now()
			const lock = roomRec.locks.get(id)
			const takenByOther =
				lock && lock.socketId !== socket.id && now < lock.until
			if (takenByOther && !isStreamer && !isGhost) return // занято другим
			if (takenByOther) {
				console.log(
					'[io] перехват:',
					id.slice(0, 8),
					'был у',
					lock.login,
				)
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
		})

		socket.on('element:add', el => {
			if (!el || typeof el !== 'object') return
			// свой звук таймера не должен разрастаться сверх лимита
			if (el.soundSrc && String(el.soundSrc).length > MAX_SOUND_DATA) {
				console.log('[io] звук больше лимита, элемент не добавлен:', room.slice(0, 12))
				return
			}
			// предохранитель по памяти: комната с тяжёлыми base64-файлами не должна
			// разрастись до OOM (это убило бы и её саму, и соседние комнаты).
			// Считаем с учётом нового элемента, а не только текущего размера
			const current = roomStore.roomBytes(state)
			const withNew = current + roomStore.roomBytes({ elements: [el] })
			if (withNew > MAX_ROOM_BYTES) {
				console.log(
					'[io] комната переполнена, элемент не добавлен:',
					room.slice(0, 12),
					'~',
					Math.round(withNew / 1024 / 1024),
					'МБ',
				)
				return
			}
			el.id = el.id || Date.now() + '-' + Math.random().toString(36).slice(2, 9)
			el.zIndex = el.zIndex ?? state.elements.length
			el.visible = el.visible ?? true
			state.elements.push(el)
			io.to(room).emit('element:added', el)
			void trimMemory()
		})

		socket.on('element:update', partial => {
			if (!partial || typeof partial.id !== 'string') return
			const idx = state.elements.findIndex(e => e.id === partial.id)
			if (idx < 0) return
			if (partial.soundSrc && String(partial.soundSrc).length > MAX_SOUND_DATA) {
				console.log('[io] звук больше лимита, обновление отклонено:', room.slice(0, 12))
				return
			}
			const oldEl = state.elements[idx]
			// медиа можно менять и через update: проверяем, что комната не переполнится
			if (partial.src !== undefined || partial.soundSrc !== undefined) {
				const before = roomStore.roomBytes({ elements: [oldEl] })
				const after = roomStore.roomBytes({ elements: [{ ...oldEl, ...partial }] })
				if (roomStore.roomBytes(state) - before + after > MAX_ROOM_BYTES) {
					console.log('[io] комната переполнена, обновление отклонено:', room.slice(0, 12))
					return
				}
			}
			state.elements[idx] = { ...oldEl, ...partial }
			socket.broadcast.to(room).emit('element:updated', state.elements[idx])
		})

		socket.on('element:move', data => {
			const idx = state.elements.findIndex(e => e.id === data.id)
			if (idx >= 0) {
				const lock = roomRec.locks.get(data.id)
				const now = Date.now()
				if (lock && lock.socketId !== socket.id && now < lock.until) {
					if (!isStreamer && !isGhost) return // объект тащит другой
					// стример/невидимка двигает чужой элемент — лок переходит к нему
					roomRec.locks.set(data.id, {
						socketId: socket.id,
						login: userLogin,
						until: now + 5000,
					})
					io.to(room).emit('element:lock', {
						id: data.id,
						by: isGhost ? '' : userLogin,
						until: now + 5000,
					})
				} else if (lock && lock.socketId === socket.id) {
					lock.until = now + 5000 // продлеваем лок, пока тащат
				}
				state.elements[idx].x = data.x
				state.elements[idx].y = data.y
				socket.broadcast.to(room).emit('element:moved', data)
			}
		})

		socket.on('element:resize', data => {
			const idx = state.elements.findIndex(e => e.id === data.id)
			if (idx >= 0) {
				const lock = roomRec.locks.get(data.id)
				const now = Date.now()
				if (lock && lock.socketId !== socket.id && now < lock.until) {
					if (!isStreamer && !isGhost) return // объект тащит другой
					roomRec.locks.set(data.id, {
						socketId: socket.id,
						login: userLogin,
						until: now + 5000,
					})
					io.to(room).emit('element:lock', {
						id: data.id,
						by: isGhost ? '' : userLogin,
						until: now + 5000,
					})
				} else if (lock && lock.socketId === socket.id) {
					lock.until = now + 5000
				}
				const el = state.elements[idx]
				if (data.x !== undefined) el.x = data.x
				if (data.y !== undefined) el.y = data.y
				el.width = data.width
				el.height = data.height
				socket.broadcast.to(room).emit('element:resized', data)
			}
		})

		socket.on('element:delete', id => {
			state.elements = state.elements.filter(e => e.id !== id)
			roomRec.locks.delete(id)
			io.to(room).emit('element:deleted', id)
		})

		socket.on('element:reorder', ({ id, direction }) => {
			const idx = state.elements.findIndex(e => e.id === id)
			if (idx < 0) return
			if (direction === 'front' || direction === 'back') {
				// прыжок на самый верх/низ с нормализацией zIndex в 0..n-1
				const zis = state.elements.map(e => e.zIndex)
				state.elements[idx].zIndex =
					direction === 'front' ? Math.max(...zis) + 1 : Math.min(...zis) - 1
				state.elements
					.slice()
					.sort((a, b) => a.zIndex - b.zIndex)
					.forEach((e, i) => {
						e.zIndex = i
					})
			} else {
				const swap = direction === 'up' ? idx + 1 : idx - 1
				if (swap < 0 || swap >= state.elements.length) return
				const zi = state.elements[idx].zIndex
				state.elements[idx].zIndex = state.elements[swap].zIndex
				state.elements[swap].zIndex = zi
			}
			// рассылаем порядок именно по слоям, а не по порядку вставки
			io.to(room).emit(
				'element:zorder',
				state.elements
					.slice()
					.sort((a, b) => a.zIndex - b.zIndex)
					.map(e => e.id),
			)
		})

		socket.on('element:toggle-visible', id => {
			const idx = state.elements.findIndex(e => e.id === id)
			if (idx >= 0) {
				state.elements[idx].visible = !state.elements[idx].visible
				socket.broadcast.to(room).emit('element:updated', state.elements[idx])
			}
		})

		socket.on('timer:start', data => {
			const idx = state.elements.findIndex(e => e.id === data.id)
			if (idx >= 0) {
				const el = state.elements[idx]
				if (el.isRunning) return
				let elapsed = el.elapsed || 0
				if (
					el.timerDirection === 'down' &&
					el.duration &&
					elapsed >= el.duration * 1000
				) {
					elapsed = 0
				}
				el.startTime = Date.now() - elapsed
				el.isRunning = true
				io.to(room).emit('element:updated', el)
			}
		})

		socket.on('timer:pause', data => {
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
