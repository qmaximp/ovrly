'use client'

import LogoMark from '@/components/LogoMark'
import ThemeToggle from '@/components/ThemeToggle'
import WidgetFrame from '@/components/WidgetFrame'
import type { WidgetDefinition } from '@/lib/types'
import { widgetHasTwitchIntegration } from '@/lib/widgets'
import { Eye, EyeOff, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type AdminWidget = {
	id: string
	owner: string
	name: string
	definition: WidgetDefinition
	updatedAt: string
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
	if (sec < 86400)
		return `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`
	return `${Math.floor(sec / 86400)} д ${Math.floor((sec % 86400) / 3600)} ч`
}

function fmtClock(at: number | null | undefined): string {
	if (!at) return '—'
	const d = new Date(at)
	return d.toLocaleTimeString('ru-RU', {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	})
}

function TwitchIcon({ size = 14 }: { size?: number }) {
	return (
		<svg
			viewBox='0 0 24 24'
			fill='currentColor'
			width={size}
			height={size}
			aria-hidden='true'
		>
			<path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z' />
		</svg>
	)
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
	const [adminWidgets, setAdminWidgets] = useState<AdminWidget[]>([])
	const [widgetsLoading, setWidgetsLoading] = useState(false)
	const [widgetsError, setWidgetsError] = useState('')
	const [widgetQuery, setWidgetQuery] = useState('')
	const [openWidget, setOpenWidget] = useState<string | null>(null)
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
		window.open(
			'/admin?window=1',
			'ovrly-admin',
			'width=1100,height=820,menubar=no,toolbar=no',
		)
	}, [])

	const refresh = useCallback(() => {
		socketRef.current?.emit('admin:stats')
	}, [])

	const loadAdminWidgets = useCallback(async () => {
		setWidgetsLoading(true)
		setWidgetsError('')
		try {
			const res = await fetch('/api/admin/widgets')
			const data = await res.json()
			if (!res.ok)
				throw new Error(data?.error || 'Не удалось загрузить виджеты')
			setAdminWidgets(Array.isArray(data.widgets) ? data.widgets : [])
		} catch (e: any) {
			setWidgetsError(e?.message || 'Не удалось загрузить виджеты')
		} finally {
			setWidgetsLoading(false)
		}
	}, [])

	useEffect(() => {
		void loadAdminWidgets()
	}, [loadAdminWidgets])

	const deleteAdminWidget = useCallback(
		async (w: AdminWidget) => {
			if (
				!confirm(
					`Удалить «${w.name}» из публичной библиотеки? У автора в комнате копия останется.`,
				)
			)
				return
			try {
				const res = await fetch(
					`/api/admin/widgets?id=${encodeURIComponent(w.id)}`,
					{ method: 'DELETE' },
				)
				const data = await res.json()
				if (!res.ok) throw new Error(data?.error || 'Не удалось удалить виджет')
				if (openWidget === w.id) setOpenWidget(null)
				await loadAdminWidgets()
			} catch (e: any) {
				setWidgetsError(e?.message || 'Не удалось удалить виджет')
			}
		},
		[loadAdminWidgets, openWidget],
	)

	const filteredWidgets = useMemo(() => {
		const q = widgetQuery.trim().toLowerCase()
		if (!q) return adminWidgets
		return adminWidgets.filter(w => {
			const text = [
				w.name,
				w.owner,
				w.definition?.name,
				w.definition?.description,
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
			return text.includes(q)
		})
	}, [adminWidgets, widgetQuery])

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
	const overlaysOnline =
		peopleOnline.length === 0 && onlineUsers.length === 0
			? 0
			: onlineUsers
					.filter(u => u.role === 'guest')
					.reduce((s, u) => s + u.connections, 0)
	// пустые комнаты без владельца (в списке выглядели как «---») не показываем
	const visibleRooms = stats
		? stats.rooms.filter(r => r.owner && r.owner !== '—')
		: []

	return (
		<main className='landing admin-page'>
			<div className='landing-bg' aria-hidden='true'>
				<div className='aurora aurora-a' />
				<div className='aurora aurora-b' />
				<div className='landing-grid' />
			</div>
			<div className='landing-content'>
				<header className='site-header admin-header'>
					<div className='admin-container header-inner'>
						<a className='brand' href='/'>
							<span className='brand-mark'>
								<LogoMark size={30} />
							</span>
							<span>Ovrly</span>
							<span className='admin-title-sep'>/</span>
							<span className='admin-title'>Админ-панель</span>
						</a>
						<span
							className={`admin-status ${connected ? 'is-online' : 'is-offline'}`}
						>
							<span className='admin-status-dot' />
							{connected ? 'сервер: онлайн' : 'сервер: оффлайн'}
						</span>
						<span className='admin-user'>{login}</span>
						<div className='flex-1' />
						<ThemeToggle />
						{!standalone && (
							<button
								onClick={openWindow}
								title='Открыть отдельным окном — удобно держать рядом со стримом'
								className='btn btn-ghost btn-sm'
							>
								⧉ <span className='hidden sm:inline'>Отдельным окном</span>
							</button>
						)}
						<button onClick={refresh} className='btn btn-ghost btn-sm'>
							↻ <span className='hidden sm:inline'>Обновить</span>
						</button>
						<a href='/cabinet' className='btn btn-ghost btn-sm'>
							В кабинет
						</a>
					</div>
				</header>

				<div className='admin-container admin-body'>
					{error && <p className='alert'>{error}</p>}
					{!stats ? (
						<div className='glass-card admin-empty'>Загружаю статистику…</div>
					) : (
						<div className='admin-stack'>
							<div className={`admin-alert ${busy ? 'is-busy' : 'is-ok'}`}>
								<span className='text-lg'>{busy ? '⏳' : '✅'}</span>
								<span>
									{busy
										? `Сейчас работают: ${stats.activity.edits5m} правок за 5 минут — обновление задело бы их`
										: 'За последние 5 минут правок не было — можно заливать обновление'}
								</span>
								{stats.activity.lastAt && (
									<span className='ml-auto'>
										последнее действие: {fmtClock(stats.activity.lastAt)}
									</span>
								)}
							</div>

							<div className='admin-stats'>
								{[
									{
										label: 'Людей онлайн',
										value: stats.totals.people,
										hint: 'уникальные ники',
									},
									{
										label: 'Оверлеев',
										value: overlaysOnline,
										hint: 'браузер-источники OBS',
									},
									{
										label: 'Комнат',
										value: visibleRooms.length,
										hint: 'рабочих',
									},
									{ label: 'Элементов', value: stats.totals.elements },
									{
										label: 'Объём',
										value: `${stats.totals.bytesMB} МБ`,
									},
									{
										label: 'Память',
										value: `${stats.memory.rssMB} МБ`,
										hint: `heap ${stats.memory.heapMB} МБ`,
									},
									{ label: 'Аптайм', value: fmtSec(stats.uptimeSec) },
								].map(k => (
									<div key={k.label} className='admin-stat'>
										<p className='admin-stat-label'>{k.label}</p>
										<p className='admin-stat-value'>{k.value}</p>
										{k.hint && <p className='admin-stat-hint'>{k.hint}</p>}
									</div>
								))}
							</div>

							<div className='admin-grid'>
								<section className='glass-card admin-card'>
									<div className='admin-card-head'>
										<div>
											<span className='kicker'>Онлайн</span>
											<h2 className='admin-card-title'>Кто сейчас на сайте</h2>
										</div>
									</div>
									{peopleOnline.length === 0 ? (
										<p className='admin-empty'>
											Никого нет. Оверлеи OBS в этот список не попадают.
										</p>
									) : (
										<div className='admin-list'>
											{peopleOnline.map((u, i) => (
												<div key={u.login + i} className='admin-list-row'>
													<span className='admin-role-icon'>
														{u.role === 'streamer' ? '🎥' : '🗡'}
													</span>
													<div className='min-w-0'>
														<a
															href={`https://www.twitch.tv/${u.login}`}
															target='_blank'
															rel='noopener noreferrer'
															className='admin-person-link'
														>
															{u.login} <TwitchIcon size={10} />
														</a>
														<p className='admin-person-meta'>
															{ROLE_LABELS[u.role]} ·{' '}
															{u.owner !== '—' ? u.owner : u.room}
														</p>
													</div>
													{u.owner !== '—' && u.roomToken && (
														<button
															onClick={() =>
																openGhostPanel(u.roomToken, u.owner)
															}
															title={`Войти в панель ${u.owner} невидимо — вас не будет в списке участников`}
															aria-label={`Войти в панель ${u.owner} невидимо`}
															className='admin-icon-btn'
														>
															👻
														</button>
													)}
													{u.connections > 1 && (
														<span
															className='admin-room-badge'
															title='столько вкладок открыто у этого пользователя'
														>
															×{u.connections}
														</span>
													)}
													<div className='flex-1' />
													<span
														className={`text-xs ${u.seenSec < 30 ? 'text-green-400' : 'text-gray-500'}`}
														title='последнее действие'
													>
														{u.seenSec < 5
															? 'активен'
															: `${fmtSec(u.seenSec)} назад`}
													</span>
													<span className='admin-room-edit'>
														{fmtSec(u.connectedSec)}
													</span>
												</div>
											))}
										</div>
									)}
								</section>

								<section className='glass-card admin-card'>
									<div className='admin-card-head'>
										<div>
											<span className='kicker'>Комнаты</span>
											<h2 className='admin-card-title'>
												Комнаты ({visibleRooms.length})
											</h2>
										</div>
									</div>
									{visibleRooms.length === 0 ? (
										<p className='admin-empty'>Рабочих комнат нет</p>
									) : (
										<div className='admin-list'>
											{visibleRooms.map(r => (
												<div key={r.key} className='admin-room-row'>
													<div className='min-w-0 flex-1'>
														<a
															href={`https://www.twitch.tv/${r.owner}`}
															target='_blank'
															rel='noopener noreferrer'
															className='admin-room-owner'
														>
															{r.owner}
														</a>
														<p className='admin-room-meta'>
															{r.elements} эл.
															{r.bytesMB > 0 ? ` · ${r.bytesMB} МБ` : ''} ·
															сокетов: {r.sockets}
														</p>
													</div>
													<span
														className={`admin-room-badge ${r.dirty ? 'dirty' : 'ok'}`}
													>
														{r.dirty ? 'не сохранено' : 'сохранено'}
													</span>
													<span className='admin-room-edit'>
														{r.lastEditSec === null
															? 'без правок'
															: `правка ${fmtSec(r.lastEditSec)} назад`}
													</span>
													{r.token && (
														<button
															onClick={() => openGhostPanel(r.token, r.owner)}
															title={`Войти в панель ${r.owner} невидимо`}
															aria-label={`Войти в панель ${r.owner} невидимо`}
															className='admin-icon-btn'
														>
															👻
														</button>
													)}
												</div>
											))}
										</div>
									)}
								</section>
							</div>

							<div className='admin-grid'>
								<section className='glass-card admin-card'>
									<div className='admin-card-head'>
										<div>
											<span className='kicker'>Плагины</span>
											<h2 className='admin-card-title'>
												Публичные виджеты ({filteredWidgets.length})
											</h2>
										</div>
										<button
											onClick={() => void loadAdminWidgets()}
											className='btn btn-ghost btn-sm'
											title='Обновить список виджетов'
										>
											↻ <span className='hidden sm:inline'>Обновить</span>
										</button>
									</div>
									<p className='cabinet-muted'>
										Виджеты из публичной библиотеки. Удаление убирает
										публикацию; копии, уже добавленные в комнаты, остаются.
									</p>
									<div className='admin-notice-row'>
										<div className='relative flex-1'>
											<Search
												size={15}
												className='absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none'
											/>
											<input
												value={widgetQuery}
												onChange={e => setWidgetQuery(e.target.value)}
												placeholder='Поиск по названию или автору'
												aria-label='Поиск публичных виджетов'
												className='admin-input w-full pl-9'
											/>
										</div>
									</div>
									{widgetsError && <p className='alert mt-3'>{widgetsError}</p>}
									{widgetsLoading && !adminWidgets.length ? (
										<p className='admin-empty'>Загружаю виджеты…</p>
									) : filteredWidgets.length === 0 ? (
										<p className='admin-empty'>
											{widgetQuery
												? `Ничего не найдено по запросу «${widgetQuery}»`
												: 'Публичных виджетов пока нет'}
										</p>
									) : (
										<div className='admin-widget-table'>
											<div className='admin-widget-head' aria-hidden='true'>
												<span>Виджеты</span>
												<span>Автор</span>
												<span>Размер</span>
												<span>Переменные</span>
												<span>Опубликован</span>
												<span />
											</div>
											{filteredWidgets.map(w => (
												<div key={w.id} className='admin-widget-item'>
													<div className='admin-widget-row'>
														<div className='min-w-0'>
															<div className='flex items-center gap-2 min-w-0'>
																<span className='admin-role-icon'>🧩</span>
																<span className='admin-widget-name'>
																	{w.name}
																</span>
																{w.definition &&
																	widgetHasTwitchIntegration(w.definition) && (
																		<span className='admin-room-badge shrink-0'>
																			Twitch
																		</span>
																	)}
															</div>
															<span className='admin-widget-mobile-meta'>
																@{w.owner} · {w.definition?.width ?? '?'}×
																{w.definition?.height ?? '?'} ·{' '}
																{w.definition?.variables?.length ?? 0} перем. ·{' '}
																{new Date(w.updatedAt).toLocaleDateString(
																	'ru-RU',
																)}
															</span>
														</div>
														<a
															href={`https://www.twitch.tv/${w.owner}`}
															target='_blank'
															rel='noopener noreferrer'
															className='admin-widget-cell admin-widget-author'
														>
															@{w.owner}
														</a>
														<span className='admin-widget-cell admin-widget-size'>
															{w.definition?.width ?? '?'}×
															{w.definition?.height ?? '?'}
														</span>
														<span className='admin-widget-cell admin-widget-vars'>
															{w.definition?.variables?.length ?? 0} перем.
														</span>
														<span className='admin-widget-cell admin-widget-date'>
															{new Date(w.updatedAt).toLocaleDateString(
																'ru-RU',
															)}
														</span>
														<div className='admin-widget-actions'>
															<button
																onClick={() =>
																	setOpenWidget(v => (v === w.id ? null : w.id))
																}
																title={
																	openWidget === w.id
																		? 'Скрыть предпросмотр'
																		: 'Показать предпросмотр'
																}
																aria-label={
																	openWidget === w.id
																		? 'Скрыть предпросмотр'
																		: 'Показать предпросмотр'
																}
																className='admin-icon-btn'
															>
																{openWidget === w.id ? (
																	<EyeOff size={15} />
																) : (
																	<Eye size={15} />
																)}
															</button>
															<button
																onClick={() => void deleteAdminWidget(w)}
																title='Удалить из публичной библиотеки'
																aria-label={`Удалить виджет ${w.name}`}
																className='admin-icon-btn text-red-400 hover:text-red-300'
															>
																<Trash2 size={15} />
															</button>
														</div>
													</div>
													{openWidget === w.id && (
														<div
															className='admin-widget-preview'
															style={{
																maxWidth: Math.min(
																	360,
																	w.definition?.width || 360,
																),
																aspectRatio: `${Math.max(1, w.definition?.width || 360)} / ${Math.max(1, w.definition?.height || 200)}`,
															}}
														>
															<WidgetFrame widget={w.definition} preview />
														</div>
													)}
												</div>
											))}
										</div>
									)}
								</section>

								<section className='glass-card admin-card'>
									<div className='admin-card-head'>
										<div>
											<span className='kicker'>Оповещение</span>
											<h2 className='admin-card-title'>Предупредить всех</h2>
										</div>
									</div>
									<p className='cabinet-muted'>
										Сообщение появится баннером у всех, кто сейчас в панели
										(например: «через 5 минут обновление, сохраните работу»).
									</p>
									<div className='admin-notice-row'>
										<input
											value={announce}
											onChange={e => setAnnounce(e.target.value)}
											onKeyDown={e => {
												if (e.key === 'Enter') sendAnnounce()
											}}
											placeholder='Текст предупреждения'
											className='admin-input'
										/>
										<button
											onClick={sendAnnounce}
											disabled={!announce.trim()}
											className='btn btn-primary btn-sm'
										>
											Отправить
										</button>
									</div>
									{announced && (
										<p className='text-xs text-green-400 mt-2'>
											Отправлено: «{announced}»
										</p>
									)}
								</section>
							</div>

							<p className='admin-meta'>
								Статистика обновляется каждые 5 секунд · данные: {stats.dataDir}{' '}
								· вы вошли как {login}
							</p>
						</div>
					)}
				</div>
			</div>
		</main>
	)
}
