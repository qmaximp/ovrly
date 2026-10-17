'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io as ioInit } from 'socket.io-client'

// Данные статистики с сервера (server.js → admin:stats)
type StatsUser = {
	login: string
	role: 'streamer' | 'moderator' | 'guest'
	seenSec: number
	connectedSec: number
	// сколько вкладок/подключений держит этот ник
	connections: number
}
type StatsRoom = {
	key: string
	// полный токен комнаты — только для кнопки «войти невидимо» (статистика админская)
	token: string
	owner: string
	elements: number
	bytesMB: number
	sockets: number
	dirty: boolean
	lastActivitySec: number
	lastEditSec: number | null
	edits: number
	users: StatsUser[]
}
type Stats = {
	now: number
	uptimeSec: number
	memory: { rssMB: number; heapMB: number }
	dataDir: string
	totals: {
		rooms: number
		elements: number
		bytesMB: number
		sockets: number
		people: number
		admins: number
	}
	activity: { actions5m: number; edits5m: number; lastAt: number | null }
	rooms: StatsRoom[]
}

const ROLE_LABELS: Record<StatsUser['role'], string> = {
	streamer: 'автор',
	moderator: 'модератор',
	guest: 'оверлей',
}

function fmtSec(sec: number | null | undefined): string {
	if (sec === null || sec === undefined) return '—'
	if (sec < 60) return `${sec} с`
	if (sec < 3600) return `${Math.floor(sec / 60)} мин`
	if (sec < 86400) return `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`
	return `${Math.floor(sec / 86400)} д ${Math.floor((sec % 86400) / 3600)} ч`
}

function fmtClock(at: number | null | undefined): string {
	if (!at) return '—'
	const d = new Date(at)
	return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function AdminClient({
	login,
	standalone,
}: {
	login: string
	// страница уже открыта отдельным окном — кнопку «отдельным окном» не показываем
	standalone?: boolean
}) {
	const [stats, setStats] = useState<Stats | null>(null)
	const [connected, setConnected] = useState(false)
	const [error, setError] = useState('')
	const [announce, setAnnounce] = useState('')
	const [announced, setAnnounced] = useState('')
	const socketRef = useRef<ReturnType<typeof ioInit> | null>(null)

	useEffect(() => {
		// admin=1 — служебное соединение: сервер отдаёт только статистику и не
		// занимает комнату (иначе фильтры «кто онлайн» показывали бы саму админку)
		const socket = ioInit({
			transports: ['websocket', 'polling'],
			query: { admin: '1' },
		})
		socketRef.current = socket
		socket.on('connect', () => {
			setConnected(true)
			setError('')
		})
		socket.on('disconnect', () => setConnected(false))
		socket.on('access:revoked', () => {
			setError('Сервер отклонил доступ: этот аккаунт не администратор')
			socket.disconnect()
		})
		socket.on('admin:stats', (data: Stats) => setStats(data))
		return () => {
			socket.disconnect()
		}
	}, [])

// Админка задумана как самостоятельная страница: её удобно держать отдельным окном
	// рядом со стримом и не отвлекаться на вкладку панели
	const openWindow = useCallback(() => {
		window.open('/admin?window=1', 'ovrly-admin', 'width=1100,height=820,menubar=no,toolbar=no')
	}, [])

	const refresh = useCallback(() => {
		socketRef.current?.emit('admin:stats')
	}, [])

	const sendAnnounce = useCallback(() => {
		const text = announce.trim()
		if (!text) return
		socketRef.current?.emit('admin:announce', { text })
		setAnnounce('')
		setAnnounced(text)
		setTimeout(() => setAnnounced(''), 2500)
	}, [announce])

	// Раз в секунду обновляем «сколько секунд назад» — сами данные приходят каждые 5 с
	const [, tick] = useState(0)
	useEffect(() => {
		const t = setInterval(() => tick(v => v + 1), 1000)
		return () => clearInterval(t)
	}, [])

	const busy = stats ? stats.activity.edits5m > 0 : false
	const onlineUsers = stats
		? stats.rooms.flatMap(r =>
				r.users.map(u => ({
					...u,
					room: r.key,
					owner: r.owner,
					roomToken: r.token,
				})),
			)
		: []
	// Невидимый вход: открываем панель комнаты с ?ghost=1. Сервер проверит, что
	// вошедший — администратор, и не добавит его в список участников комнаты
	const openGhostPanel = useCallback((token: string, owner: string) => {
		if (!token) return
		window.open(
			`/panel?room=${encodeURIComponent(token)}&ghost=1`,
			`ovrly-ghost-${encodeURIComponent(owner)}`,
			'width=1280,height=860,menubar=no,toolbar=no',
		)
	}, [])
	const peopleOnline = onlineUsers.filter(u => u.role !== 'guest')
	// оверлеев может быть несколько (каждый Browser Source — отдельное подключение)
	const overlaysOnline = peopleOnline.length === 0 && onlineUsers.length === 0
		? 0
		: onlineUsers.filter(u => u.role === 'guest').reduce((s, u) => s + u.connections, 0)

	return (
		<main className='min-h-screen bg-bg text-gray-200 px-5 py-4'>
			<header className='flex items-center gap-3 flex-wrap mb-4'>
				<h1 className='text-xl font-semibold text-[color:var(--c-on-bg)]'>Админ-панель</h1>
				<span
					className={`flex items-center gap-1.5 text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}
				>
					<span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
					{connected ? 'сервер: онлайн' : 'сервер: оффлайн'}
				</span>
				<span className='text-xs text-gray-500'>{login}</span>
				<div className='flex-1' />
				{!standalone && (
					<button
						onClick={openWindow}
					title='Открыть отдельным окном — удобно держать рядом со стримом'
					className='px-3 py-1.5 text-xs rounded-lg bg-border hover:bg-gray-600 transition-colors'
				>
						⧉ Отдельным окном
					</button>
				)}
				<button
					onClick={refresh}
					className='px-3 py-1.5 text-xs rounded-lg bg-border hover:bg-gray-600 transition-colors'
				>
					↻ Обновить
				</button>
				<a
					href='/cabinet'
					className='px-3 py-1.5 text-xs rounded-lg bg-border hover:bg-gray-600 transition-colors'
				>
					В кабинет
				</a>
			</header>

			{error && (
				<p className='mb-4 text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg px-4 py-3'>
					{error}
				</p>
			)}

			{!stats ? (
				<p className='text-sm text-gray-500'>Загружаю статистику…</p>
			) : (
				<div className='space-y-4'>
					{/* Главный ответ на вопрос «можно ли деплоить?» */}
					<div
						className={`rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap ${
							busy
								? 'border-amber-900/50 bg-amber-950/30 text-amber-300'
								: 'border-green-900/50 bg-green-950/25 text-green-300'
						}`}
					>
						<span className='text-lg'>{busy ? '⏳' : '✅'}</span>
						<span className='text-sm'>
							{busy
								? `Сейчас работают: ${stats.activity.edits5m} правок за 5 минут — обновление задело бы их`
								: 'За последние 5 минут правок не было — можно заливать обновление'}
						</span>
						{stats.activity.lastAt && (
							<span className='text-xs opacity-80 ml-auto'>
								последнее действие: {fmtClock(stats.activity.lastAt)}
							</span>
						)}
					</div>

					{/* KPI */}
					<div className='grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3'>
						{[
							{ label: 'Людей онлайн', value: stats.totals.people, hint: 'уникальные ники' },
							{ label: 'Оверлеев', value: overlaysOnline, hint: 'браузер-источники OBS' },
							{ label: 'Комнат', value: stats.totals.rooms },
							{ label: 'Элементов', value: stats.totals.elements },
							{ label: 'Объём', value: `${stats.totals.bytesMB} МБ` },
							{ label: 'Память', value: `${stats.memory.rssMB} МБ`, hint: `heap ${stats.memory.heapMB} МБ` },
							{ label: 'Аптайм', value: fmtSec(stats.uptimeSec) },
						].map(k => (
							<div key={k.label} className='bg-panel border border-border rounded-xl px-3 py-2.5'>
								<p className='text-[11px] text-gray-500 uppercase tracking-wide'>{k.label}</p>
								<p className='text-lg font-semibold text-[color:var(--c-on-bg)]'>{k.value}</p>
								{k.hint && <p className='text-[10px] text-gray-600'>{k.hint}</p>}
							</div>
						))}
					</div>

					<div className='grid lg:grid-cols-2 gap-4'>
						{/* Кто сейчас на сайте */}
						<section className='bg-panel border border-border rounded-xl p-4'>
							<h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'>
								Кто сейчас на сайте
							</h2>
							{onlineUsers.length === 0 ? (
								<p className='text-sm text-gray-600'>Никого нет</p>
							) : (
								<div className='space-y-1'>
									{onlineUsers.map((u, i) => (
										<div
											key={u.login + i}
											className='flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-border/50'
										>
											<span className='text-gray-300'>
												{u.role === 'streamer' ? '🎥' : u.role === 'moderator' ? '🗡' : '🖥'}
											</span>
											<span className='font-medium text-[color:var(--c-on-bg)] truncate'>
												{u.login}
											</span>
											{u.owner !== '—' && u.roomToken && (
												<button
													onClick={() => openGhostPanel(u.roomToken, u.owner)}
													title={`Войти в панель ${u.owner} невидимо — вас не будет в списке участников`}
													aria-label={`Войти в панель ${u.owner} невидимо`}
													className='shrink-0 w-6 h-6 rounded-md bg-border hover:bg-accent text-xs leading-none flex items-center justify-center transition-colors'
												>
													👻
												</button>
											)}
											<span className='text-xs text-gray-500'>{ROLE_LABELS[u.role]}</span>
											{u.connections > 1 && (
												<span
													className='text-[10px] px-1.5 py-0.5 rounded-full bg-border text-gray-400'
													title='столько вкладок открыто у этого пользователя'
												>
													×{u.connections}
												</span>
											)}
											<div className='flex-1' />
											<span className='text-xs text-gray-500' title='комната'>
												{u.owner !== '—' ? u.owner : u.room}
											</span>
											<span
												className={`text-xs ${u.seenSec < 30 ? 'text-green-400' : 'text-gray-500'}`}
												title='последнее действие'
											>
												{u.seenSec < 5 ? 'активен' : `${u.seenSec} с назад`}
											</span>
											<span className='text-[10px] text-gray-600 w-16 text-right'>
												{fmtSec(u.connectedSec)}
											</span>
										</div>
									))}
								</div>
							)}
						</section>

						{/* Комнаты */}
						<section className='bg-panel border border-border rounded-xl p-4'>
							<h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'>
								Комнаты ({stats.rooms.length})
							</h2>
							<div className='space-y-1 max-h-[320px] overflow-y-auto'>
								{stats.rooms.map(r => (
									<div key={r.key} className='flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-border/50'>
										<span className='font-medium text-[color:var(--c-on-bg)] truncate w-28'>
											{r.owner}
										</span>
										<span className='text-xs text-gray-500'>{r.elements} эл.</span>
										{r.bytesMB > 0 && (
											<span className='text-xs text-gray-500'>{r.bytesMB} МБ</span>
										)}
										<span className='text-xs text-gray-500'>сокетов: {r.sockets}</span>
										{!r.dirty && <span className='text-[10px] text-green-500/70'>сохранено</span>}
										<div className='flex-1' />
										<span className='text-xs text-gray-500'>
											{r.lastEditSec === null ? '—' : `правка ${fmtSec(r.lastEditSec)} назад`}
										</span>
									</div>
								))}
							</div>
						</section>
					</div>

					{/* Предупреждение о деплое: показывается всем панелям и оверлеям сразу */}
					<section className='bg-panel border border-border rounded-xl p-4'>
						<h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3'>
							Предупредить всех
						</h2>
						<p className='text-xs text-gray-500 mb-2'>
							Сообщение появится баннером у всех, кто сейчас в панели (например: «через 5 минут
							обновление, сохраните работу»)
						</p>
						<div className='flex gap-2'>
							<input
								value={announce}
								onChange={e => setAnnounce(e.target.value)}
								onKeyDown={e => {
									if (e.key === 'Enter') sendAnnounce()
								}}
								placeholder='Текст предупреждения'
								className='flex-1 px-3 py-2 bg-bg border border-border rounded-lg text-sm'
							/>
							<button
								onClick={sendAnnounce}
								disabled={!announce.trim()}
								className='px-4 py-2 bg-accent hover:bg-violet-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50'
							>
								Отправить
							</button>
						</div>
						{announced && (
							<p className='text-xs text-green-400 mt-2'>Отправлено: «{announced}»</p>
						)}
					</section>

					<p className='text-[11px] text-gray-600'>
						Статистика обновляется каждые 5 секунд · данные: {stats.dataDir} · вы вошли как{' '}
						{login}
					</p>
				</div>
			)}
		</main>
	)
}
