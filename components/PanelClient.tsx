'use client'

import LogoMark from '@/components/LogoMark'
import {
	MediaChrome,
	TwitchFrame,
	type ChromeCtl,
	type MediaSt,
} from '@/components/MediaPlayer'
import TextStyleControls from '@/components/TextStyleControls'
import WidgetVariableControl from '@/components/WidgetControls'
import WidgetFrame from '@/components/WidgetFrame'
import { NumberField } from '@/components/fields'
import { noteServerClock, serverClockLag } from '@/lib/clock'
import { colorWithOpacity } from '@/lib/color'
import { toEmbedUrl, youtubePlaylistId } from '@/lib/embed'
import {
	cannotBeFramed,
	isLiveLink,
	isMediaUrl,
	loadTwitchSdk,
	mediaKeyFor,
	parseMediaUrl,
	youtubeEmbedUrl,
} from '@/lib/media'
import { analyzeSound, playTimerSound, type SoundAnalysis } from '@/lib/sound'
import { ensureFontLoaded, textBoxStyle } from '@/lib/textStyle'
import type {
	RoomUser,
	StreamElement,
	SyncState,
	WidgetDefinition,
} from '@/lib/types'
import {
	Blocks,
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	Film,
	Globe,
	ImagePlus,
	Layers,
	Link2,
	ListVideo,
	Lock,
	MessageCircle,
	Monitor,
	Pencil,
	Play,
	Plus,
	Settings,
	SlidersHorizontal,
	Smile,
	Square,
	Timer,
	Trash2,
	Type,
	Upload,
	Volume2,
	X,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { io as ioInit, Socket } from 'socket.io-client'

// obs-websocket-js — тяжёлая зависимость; грузим её только когда впервые открыли OBS
const ObsPanel = dynamic(() => import('@/components/ObsPanel'), {
	ssr: false,
	loading: () => (
		<p className='p-4 text-sm text-gray-500'>Загрузка панели OBS…</p>
	),
})

// студия виджетов нужна не всегда: грузим чанк только при первом открытии
const WidgetStudio = dynamic(() => import('@/components/WidgetStudio'), {
	ssr: false,
	loading: () => (
		<p className='p-4 text-sm text-gray-500'>Загрузка виджетов…</p>
	),
})

const CANVAS_W = 1920
const CANVAS_H = 1080

// Файл с ПК: сначала пробуем R2 (сервер вернёт URL), иначе — прежний base64.
// 501 от /api/media означает, что R2 не настроен: панель работает как раньше.
async function uploadMediaFile(file: File): Promise<string | null> {
	try {
		const qs = new URLSearchParams({ name: file.name, type: file.type || '' })
		const res = await fetch(`/api/media?${qs}`, {
			method: 'POST',
			headers: { 'Content-Type': file.type || 'application/octet-stream' },
			body: file,
		})
		if (!res.ok) return null
		const data = (await res.json()) as { url?: unknown }
		return typeof data?.url === 'string' ? data.url : null
	} catch {
		return null
	}
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((res, rej) => {
		const r = new FileReader()
		r.onload = () => res(r.result as string)
		r.onerror = rej
		r.readAsDataURL(file)
	})
}

async function fileToSrc(file: File): Promise<string> {
	return (await uploadMediaFile(file)) || fileToDataUrl(file)
}

type Emote = {
	platform: string
	code: string
	url: string
	scope?: 'channel' | 'personal' | 'global'
}

// Клиентский кэш смайликов: сервер уже кэширует ответ, но повторное открытие
// пикера не должно ждать даже его. sessionStorage переживает перезагрузку вкладки,
// TTL короче серверного — данные успевают обновиться.
const EMOTE_CACHE_KEY = 'panel:emotes:v1'
const EMOTE_CACHE_TTL = 15 * 60 * 1000
type EmoteCacheEntry = {
	at: number
	channel: string
	emotes: Emote[]
	notes: string[]
}
let emoteMemCache: EmoteCacheEntry | null = null

function readEmoteCache(channel: string): EmoteCacheEntry | null {
	try {
		const raw = sessionStorage.getItem(EMOTE_CACHE_KEY)
		const j = raw ? (JSON.parse(raw) as EmoteCacheEntry) : emoteMemCache
		if (
			j &&
			j.channel === channel &&
			Date.now() - j.at < EMOTE_CACHE_TTL &&
			Array.isArray(j.emotes)
		)
			return j
	} catch {}
	return null
}

function writeEmoteCache(channel: string, emotes: Emote[], notes: string[]) {
	const entry: EmoteCacheEntry = { at: Date.now(), channel, emotes, notes }
	emoteMemCache = entry
	try {
		sessionStorage.setItem(EMOTE_CACHE_KEY, JSON.stringify(entry))
	} catch {}
}

function clearEmoteCache() {
	emoteMemCache = null
	try {
		sessionStorage.removeItem(EMOTE_CACHE_KEY)
	} catch {}
}

export default function PanelClient({
	channel,
	room,
	userLogin,
	ghost,
}: {
	channel?: string | null
	room?: string | null
	userLogin?: string | null
	// невидимый вход администратора: сервер не показывает его другим участникам
	ghost?: boolean
}) {
	const [state, setState] = useState<SyncState>({
		elements: [],
		canvasW: CANVAS_W,
		canvasH: CANVAS_H,
	})
	const [connected, setConnected] = useState(false)
	// стример отозвал доступ — сервер закрыл соединение; блокируем панель целиком
	const [accessRevoked, setAccessRevoked] = useState(false)
	// предупреждение от админа (деплой и т.п.): приходит событием server:notice
	const [notice, setNotice] = useState<string | null>(null)
	// сервер не увидел валидную сессию: панель открыта, но правки не сохраняются
	const [readOnly, setReadOnly] = useState(false)
	const [tab, setTab] = useState<
		'elements' | 'widgets' | 'obs' | 'chat' | 'settings'
	>('elements')
	// ObsPanel монтируем при первом открытии вкладки и больше не размонтируем:
	// так соединение с OBS не рвётся при переключении, а чанк не грузится зря
	const [obsMounted, setObsMounted] = useState(false)
	useEffect(() => {
		if (tab === 'obs') setObsMounted(true)
	}, [tab])
	// вкладка OBS временно скрыта по умолчанию; включается тоглом в настройках
	const [showObsTab, setShowObsTab] = useState(false)
	useEffect(() => {
		try {
			if (localStorage.getItem('panel:obs-tab') === '1') setShowObsTab(true)
		} catch {}
	}, [])
	useEffect(() => {
		if (!showObsTab) setTab(t => (t === 'obs' ? 'elements' : t))
	}, [showObsTab])
	const toggleObsTab = useCallback(() => {
		setShowObsTab(v => {
			const next = !v
			try {
				localStorage.setItem('panel:obs-tab', next ? '1' : '0')
			} catch {}
			return next
		})
	}, [])
	// студия виджетов: монтируем при первом открытии, чтобы не терять черновик
	const [widgetStudioMounted, setWidgetStudioMounted] = useState(false)
	// мини-окно выбора виджета из «Моих виджетов» для добавления на холст
	const [widgetPickerOpen, setWidgetPickerOpen] = useState(false)
	// запрос из свойств элемента: открыть этот виджет в редакторе
	const [pendingWidgetEdit, setPendingWidgetEdit] =
		useState<WidgetDefinition | null>(null)
	useEffect(() => {
		if (tab === 'widgets') setWidgetStudioMounted(true)
	}, [tab])
	const widgetLibrary = useMemo(
		() =>
			Object.values(state.widgets || {}).sort((a, b) =>
				a.name.localeCompare(b.name, 'ru'),
			),
		[state.widgets],
	)
	// чат стрима: на ПК — плавающее окно справа, на телефоне — отдельная
	// страница из бургер-меню; chatOn управляет только окном на ПК
	const [chatOn, setChatOn] = useState(true)
	useEffect(() => {
		try {
			if (localStorage.getItem('panel:chat') === '0') setChatOn(false)
		} catch {}
	}, [])
	useEffect(() => {
		if (!chatOn) setTab(t => (t === 'chat' ? 'elements' : t))
	}, [chatOn])
	const toggleChat = useCallback(() => {
		setChatOn(v => {
			const next = !v
			try {
				localStorage.setItem('panel:chat', next ? '1' : '0')
			} catch {}
			return next
		})
	}, [])
	// минималистичное меню: добавление элементов снизу, список элементов свёрнут.
	// Выбор хранится в браузере, чтобы не сбрасывался после перезагрузки.
	// Ключ localStorage оставлен прежним, чтобы не потерять выбор у тех, кто уже
	// включал режим, когда он назывался «бета-интерфейс».
	const [betaUI, setBetaUI] = useState(false)
	const [betaElementsOpen, setBetaElementsOpen] = useState(false)
	useEffect(() => {
		try {
			if (localStorage.getItem('panel:beta-ui') === '1') setBetaUI(true)
		} catch {}
	}, [])
	const toggleBetaUI = useCallback(() => {
		setBetaUI(v => {
			const next = !v
			try {
				localStorage.setItem('panel:beta-ui', next ? '1' : '0')
			} catch {}
			return next
		})
	}, [])
	const [theme, setTheme] = useState<'dark' | 'light'>('dark')
	const [previewOn, setPreviewOn] = useState(false)
	const [previewKey, setPreviewKey] = useState(0)
	const [twitchLive, setTwitchLive] = useState<boolean | null>(null)
	const [mounted, setMounted] = useState(false)
	useEffect(() => {
		setMounted(true)
	}, [])
	const parentHost =
		typeof window !== 'undefined' ? window.location.hostname : 'localhost'
	const [emoteOpen, setEmoteOpen] = useState(false)
	// кто сейчас на странице (ник + роль): список рассылает сервер
	const [users, setUsers] = useState<RoomUser[]>([])
	const [usersOpen, setUsersOpen] = useState(false)
	// окно участников закрывается по Esc
	useEffect(() => {
		if (!usersOpen) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setUsersOpen(false)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [usersOpen])
	const [emotes, setEmotes] = useState<Emote[]>([])
	const [emoteLoading, setEmoteLoading] = useState(false)
	const [emoteError, setEmoteError] = useState('')
	const [emoteQuery, setEmoteQuery] = useState('')
	const [emotePlatform, setEmotePlatform] = useState<
		'all' | 'twitch' | '7tv' | 'bttv' | 'ffz'
	>('all')
	const [emoteNotes, setEmoteNotes] = useState<string[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const selectedIdRef = useRef<string | null>(null)
	selectedIdRef.current = selectedId
	// мультивыделение: рамкой по пустому холсту (мышь) или ctrl+клик;
	// драг любого выбранного двигает всю группу, Delete удаляет все выбранные
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const selectedIdsRef = useRef<Set<string>>(new Set())
	selectedIdsRef.current = selectedIds
	// рамка выделения: координаты относительно вьюпорта холста
	const [marquee, setMarquee] = useState<{
		x1: number
		y1: number
		x2: number
		y2: number
	} | null>(null)
	const [interactiveIframeId, setInteractiveIframeId] = useState<string | null>(
		null,
	)
	// медиа-плееры (YouTube/Twitch): состояние элементов + SDK-плееры Twitch
	const [mediaStates, setMediaStates] = useState<Map<string, MediaSt>>(
		new Map(),
	)
	const mediaStatesRef = useRef<Map<string, MediaSt>>(mediaStates)
	const twitchPlayers = useRef<Map<string, any>>(new Map())
	const twitchStRef = useRef<Map<string, number>>(new Map()) // 1 играет / 2 пауза (из событий SDK)
	const chromeCtlRefs = useRef<Map<string, ChromeCtl>>(new Map())
	const lastYtCmdRef = useRef<Map<string, 'play' | 'pause'>>(new Map())
	const ccStatesRef = useRef<Map<string, number>>(new Map())
	// когда элементу последний раз ретранслировали позицию (seek раз в секунду)
	const lastTimeRelayPerElRef = useRef<Map<string, number>>(new Map())
	// последняя известная позиция плеера и время отчёта: по ним панель догоняет
	// оверлей, когда возвращаешься на вкладку (в фоне браузер ставит превью на паузу)
	const lastPosRef = useRef<Map<string, { t: number; at: number }>>(new Map())
	// защита от повторного «ролик закончился»: YouTube присылает state 0 несколько раз
	const playlistStepAtRef = useRef<Map<string, number>>(new Map())
	const [addSheet, setAddSheet] = useState<null | 'image' | 'video' | 'audio'>(
		null,
	)
	// модалка добавления YouTube-плейлиста
	const [playlistOpen, setPlaylistOpen] = useState(false)
	const [playlistText, setPlaylistText] = useState('')
	const [playlistUrl, setPlaylistUrl] = useState('')
	const [playlistLoopNew, setPlaylistLoopNew] = useState(true)
	const [playlistError, setPlaylistError] = useState('')
	// левую панель можно скрыть целиком (кнопка в её шапке) — канвас занимает всё место
	const [sidebarOpen, setSidebarOpen] = useState(true)
	useEffect(() => {
		try {
			if (localStorage.getItem('panel:sidebar') === '0') setSidebarOpen(false)
		} catch {}
	}, [])
	const toggleSidebar = useCallback(() => {
		setSidebarOpen(v => {
			const next = !v
			try {
				localStorage.setItem('panel:sidebar', next ? '1' : '0')
			} catch {}
			return next
		})
	}, [])
	const [addSheetClosing, setAddSheetClosing] = useState(false)
	const addSheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const closeAddSheet = () => {
		if (addSheetTimer.current) clearTimeout(addSheetTimer.current)
		setAddSheetClosing(true)
		addSheetTimer.current = setTimeout(() => {
			addSheetTimer.current = null
			setAddSheetClosing(false)
			setAddSheet(null)
		}, 180)
	}
	const socketRef = useRef<Socket | null>(null)
	const [view, setView] = useState({ x: 0, y: 0, s: 0.3 })
	const viewRef = useRef(view)
	viewRef.current = view
	const [panning, setPanning] = useState(false)
	type RemoteCursor = {
		id: string
		login: string
		x: number
		y: number
		hidden: boolean
		t: number
	}
	const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([])
	const cursorLastSent = useRef(0)
	// локи объектов: пока один тащит, другой перехватить не может; +5 секунд после остановки.
	// Стример (владелец комнаты) — исключение: двигает элементы всегда, сервер отдаёт ему лок
	const [elementLocks, setElementLocks] = useState<
		Record<string, { by: string; until: number }>
	>({})
	const isStreamer =
		!!channel &&
		!!userLogin &&
		userLogin.toLowerCase() === channel.toLowerCase()
	// стример и админ-невидимка забирают объект у любого модератора
	const canOverrideLocks = isStreamer || !!ghost
	const isLockedByOther = useCallback(
		(id: string) => {
			if (canOverrideLocks) return false
			const l = elementLocks[id]
			return !!l && l.until > Date.now() && l.by !== (userLogin ?? '')
		},
		[elementLocks, userLogin, canOverrideLocks],
	)
	const [isCoarse, setIsCoarse] = useState(false)
	useEffect(() => {
		setIsCoarse(
			window.matchMedia?.('(pointer: coarse)').matches ||
				navigator.maxTouchPoints > 0,
		)
	}, [])
	const viewportRef = useRef<HTMLDivElement | null>(null)
	// канвас появляется/исчезает при повороте телефона — эффекты панорамы/зума должны
	// перепривязываться к фактическому монтированию, а не только к первому рендеру
	const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null)
	const setViewportEl = useCallback((el: HTMLDivElement | null) => {
		viewportRef.current = el
		setCanvasEl(prev => (prev === el ? prev : el))
	}, [])
	const baseViewRef = useRef<{ x: number; y: number; s: number } | null>(null)
	// минимальный абсолютный масштаб: отдаляться можно до 5% от базового (вписанного) вида —
	// дальше холст становится микроскопическим, а превью Twitch нечитаемым
	const minScale = useCallback(() => {
		const base = baseViewRef.current?.s
		return base ? base * 0.05 : 0.001
	}, [])
	// свежий стейт для колбэков, замороженных useCallback'ом (паркинг считает каскад по актуальным элементам)
	const stateRef = useRef(state)
	stateRef.current = state

	// мобильные устройства: портрет блокируется экраном «поверни телефон», ландшафт — компактный тулбар
	const [isPortrait, setIsPortrait] = useState(false)
	const [isMobile, setIsMobile] = useState(false)
	const [sheetOpen, setSheetOpen] = useState(false)
	const [menuOpen, setMenuOpen] = useState(false)
	// на ПК отдельной вкладки чата нет: при повороте/расширении с телефона
	// возвращаемся к холсту, чат останется плавающим окном
	useEffect(() => {
		if (!isMobile && tab === 'chat') setTab('elements')
	}, [isMobile, tab])
	// Twitch-чату нужен «чистый» слой: считаем верх окна от холста, но рендерим
	// сам чат порталом в body, без клиппинга и transform-родителей
	const [chatTop, setChatTop] = useState(168)
	// отступ справа считаем от правого края холста, а не окна: когда открывается
	// панель свойств элемента, холст сужается и чат должен отъехать левее неё
	const [chatRight, setChatRight] = useState(16)
	useEffect(() => {
		const viewport = viewportRef.current
		if (!viewport) return
		const update = () => {
			const r = viewport.getBoundingClientRect()
			setChatTop(Math.round(r.top + 56))
			setChatRight(Math.max(16, Math.round(window.innerWidth - r.right + 16)))
		}
		update()
		window.addEventListener('resize', update)
		const ro =
			typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
		ro?.observe(viewport)
		return () => {
			window.removeEventListener('resize', update)
			ro?.disconnect()
		}
	}, [canvasEl, chatOn, tab, isMobile, mounted, channel])
	// плавное закрытие бургера: на время exit-анимации меню остаётся в DOM
	const [menuClosing, setMenuClosing] = useState(false)
	const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const openBurger = () => {
		if (menuCloseTimer.current) {
			clearTimeout(menuCloseTimer.current)
			menuCloseTimer.current = null
		}
		setMenuClosing(false)
		setMenuOpen(true)
	}
	const closeBurger = () => {
		if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current)
		setMenuClosing(true)
		menuCloseTimer.current = setTimeout(() => {
			menuCloseTimer.current = null
			setMenuClosing(false)
			setMenuOpen(false)
		}, 200)
	}
	const isMobileRef = useRef(false)
	isMobileRef.current = isMobile

	// вернуть элементы к снимку начала операции (лок перехватила другая панель)
	const restoreElements = useCallback(
		(
			patches: {
				id: string
				x: number
				y: number
				width?: number
				height?: number
				rotation?: number
			}[],
		) => {
			setState(p => ({
				...p,
				elements: p.elements.map(el => {
					const patch = patches.find(x => x.id === el.id)
					return patch ? { ...el, ...patch } : el
				}),
			}))
		},
		[], // eslint-disable-line react-hooks/exhaustive-deps
	)

	// забываем всё, что панель держала про удалённый элемент (состояния плееров, локи
	// и пр.): без этого карты растут всю сессию, а с base64-видео держат и сами данные
	const forgetElement = useCallback((id: string) => {
		if (mediaStatesRef.current.has(id)) {
			const m = new Map(mediaStatesRef.current)
			m.delete(id)
			mediaStatesRef.current = m
			setMediaStates(m)
		}
		twitchPlayers.current.delete(id)
		twitchStRef.current.delete(id)
		chromeCtlRefs.current.delete(id)
		lastYtCmdRef.current.delete(id)
		ccStatesRef.current.delete(id)
		lastTimeRelayPerElRef.current.delete(id)
		setElementLocks(prev => {
			if (!(id in prev)) return prev
			const next = { ...prev }
			delete next[id]
			return next
		})
		setSelectedId(s => (s === id ? null : s))
		setSelectedIds(prev => {
			if (!prev.has(id)) return prev
			const n = new Set(prev)
			n.delete(id)
			return n
		})
	}, [])

	const forgetAllElements = useCallback(() => {
		mediaStatesRef.current = new Map()
		setMediaStates(new Map())
		twitchPlayers.current.clear()
		twitchStRef.current.clear()
		chromeCtlRefs.current.clear()
		lastYtCmdRef.current.clear()
		ccStatesRef.current.clear()
		lastTimeRelayPerElRef.current.clear()
		setElementLocks({})
		setSelectedIds(new Set())
	}, [])

	useEffect(() => {
		const pq = window.matchMedia(
			'(orientation: portrait) and (max-width: 820px) and (pointer: coarse)',
		)
		const mq = window.matchMedia(
			// мобильная раскладка только на реально узких экранах: широкий тач-экран
			// (планшет/ландшафт) получает десктопную — она полностью работает от тапов
			'(max-width: 950px), (pointer: coarse) and (max-width: 820px)',
		)
		const upd = () => {
			setIsPortrait(pq.matches)
			setIsMobile(mq.matches && !pq.matches)
		}
		upd()
		pq.addEventListener('change', upd)
		mq.addEventListener('change', upd)
		return () => {
			pq.removeEventListener('change', upd)
			mq.removeEventListener('change', upd)
		}
	}, [])

	useEffect(() => {
		const socket = ioInit({
			transports: ['websocket', 'polling'],
			query: {
				room: room || 'default',
				login: userLogin || '',
				// сервер примет флаг только от администратора (проверка по cookie-сессии)
				invisible: ghost ? '1' : '0',
			},
		})
		socketRef.current = socket

		// живые курсоры других пользователей этой комнаты
		socket.on(
			'cursor:update',
			(c: {
				id: string
				login: string
				x: number
				y: number
				hidden?: boolean
			}) => {
				setRemoteCursors(prev => {
					const next = prev.filter(p => p.id !== c.id)
					if (!c.hidden)
						next.push({
							id: c.id,
							login: c.login,
							x: c.x,
							y: c.y,
							hidden: false,
							t: Date.now(),
						})
					return next
				})
			},
		)
		socket.on('cursor:leave', ({ id }: { id: string }) => {
			setRemoteCursors(prev => prev.filter(p => p.id !== id))
		})
		socket.on(
			'element:lock',
			({ id, by, until }: { id: string; by: string; until: number }) => {
				setElementLocks(prev => ({ ...prev, [id]: { by, until } }))
				// лок перехватили у нас (например, стример забрал элемент) — принудительно
				// прекращаем перетаскивание и возвращаем элемент в серверную позицию:
				// иначе на нашем экране он «уезжает» локально, хотя сервер другие изменения отклонил
				if (by !== (userLogin ?? '')) {
					if (dragRef.current?.id === id) {
						dragRef.current = null
						lastMoveRef.current = null
						document.body.classList.remove('dragging')
						const start = dragStartPosRef.current
						if (start && start.id === id) {
							setState(p => ({
								...p,
								elements: p.elements.map(e =>
									e.id === id ? { ...e, x: start.x, y: start.y } : e,
								),
							}))
						}
					}
					if (resizeRef.current?.id === id) {
						resizeRef.current = null
						document.body.classList.remove('dragging')
						const snap = resizeSnapRef.current
						if (snap && snap.id === id) {
							setState(p => ({
								...p,
								elements: p.elements.map(e =>
									e.id === id
										? {
												...e,
												x: snap.el.x,
												y: snap.el.y,
												width: snap.el.width,
												height: snap.el.height,
											}
										: e,
								),
							}))
						}
					}
					// перехватили элемент в составе группы — откатываем группу целиком
					// по снимкам, снятым в начале операции
					const gd = groupDragRef.current
					if (gd && gd.items.some(it => it.id === id)) {
						groupDragRef.current = null
						document.body.classList.remove('dragging')
						restoreElements(
							gd.items.map(it => ({ id: it.id, x: it.x, y: it.y })),
						)
					}
					const gsc = groupScaleRef.current
					if (gsc && gsc.items.some(it => it.id === id)) {
						groupScaleRef.current = null
						document.body.classList.remove('dragging')
						restoreElements(
							gsc.items.map(it => ({
								id: it.id,
								x: it.x,
								y: it.y,
								width: it.w,
								height: it.h,
							})),
						)
					}
					const grt = groupRotateRef.current
					if (grt && grt.items.some(it => it.id === id)) {
						groupRotateRef.current = null
						document.body.classList.remove('dragging')
						// снимок вращения хранит центр и угол: размеры за время поворота
						// не меняются, берём их из текущего состояния
						restoreElements(
							grt.items.map(it => {
								const el = stateRef.current.elements.find(x => x.id === it.id)
								const w = el?.width ?? 0
								const h = el?.height ?? 0
								return {
									id: it.id,
									x: Math.round(it.cx - w / 2),
									y: Math.round(it.cy - h / 2),
									rotation: it.rotation,
								}
							}),
						)
					}
				}
			},
		)
		socket.on('element:unlock', ({ id }: { id: string }) => {
			setElementLocks(prev => {
				if (!(id in prev)) return prev
				const next = { ...prev }
				delete next[id]
				return next
			})
		})

		// предупреждение от админ-панели: показываем баннером, пока его не закроют
		socket.on('server:notice', (d: { text?: string }) => {
			if (d?.text) setNotice(d.text)
		})
		socket.on('connect', () => setConnected(true))
		socket.on('disconnect', () => setConnected(false))
		// стример отозвал доступ: сервер закрыл соединение — блокируем панель
		socket.on('access:revoked', () => {
			socket.disconnect()
			setAccessRevoked(true)
		})
		// роль от сервера: без валидной сессии панель работает только на чтение —
		// показываем предупреждение, иначе правки пропадали бы молча
		socket.on('access:role', (r: { readOnly?: boolean }) =>
			setReadOnly(!!r?.readOnly),
		)
		// оверлей (пере)подключился — отдаём ему текущее состояние играющего выбранного элемента
		socket.on('overlay:hello', () => {
			const sel = selectedIdRef.current
			if (!sel) return
			const st = mediaStatesRef.current.get(sel)
			if (st?.st === 1) {
				socket.emit('element:command', { id: sel, cmd: 'play' })
				socket.emit('element:command', { id: sel, cmd: 'seek', value: st.t })
				// звук и субтитры тоже восстанавливаем: оверлей мог перезагрузиться
				// (OBS refresh) и потерять их
				socket.emit('element:command', {
					id: sel,
					cmd: st.muted ? 'mute' : 'unmute',
				})
				socket.emit('element:command', {
					id: sel,
					cmd: 'volume',
					value: st.vol,
				})
				if (st.kind === 'youtube')
					socket.emit('element:command', {
						id: sel,
						cmd: 'cc',
						value: ccStatesRef.current.get(sel) ?? 0,
					})
			}
		})
		socket.on('state:init', (s: SyncState) => setState(s))
		// кто сейчас на странице комнаты (ник + роль)
		socket.on('room:users', (list: RoomUser[]) => setUsers(list ?? []))
		// Отмена/повтор сначала добавляет элемент локально, а затем сервер присылает
		// эхо element:added. Без проверки id это давало второй такой же элемент
		// в списке и на холсте (Ctrl+Z «дублировал» картинки).
		socket.on('element:added', (el: StreamElement) =>
			setState(p => {
				const exists = p.elements.some(e => e.id === el.id)
				return {
					...p,
					elements: exists
						? p.elements.map(e => (e.id === el.id ? { ...e, ...el } : e))
						: [...p.elements, el],
				}
			}),
		)
		socket.on('element:updated', (el: StreamElement) => {
			noteServerClock(el)
			setState(p => ({
				...p,
				elements: p.elements.map(e => (e.id === el.id ? { ...e, ...el } : e)),
			}))
		})
		socket.on('element:moved', (d: { id: string; x: number; y: number }) =>
			setState(p => ({
				...p,
				elements: p.elements.map(e =>
					e.id === d.id ? { ...e, x: d.x, y: d.y } : e,
				),
			})),
		)
		socket.on(
			'element:resized',
			(d: {
				id: string
				x?: number
				y?: number
				width: number
				height: number
			}) =>
				setState(p => ({
					...p,
					elements: p.elements.map(e =>
						e.id === d.id
							? {
									...e,
									x: d.x ?? e.x,
									y: d.y ?? e.y,
									width: d.width,
									height: d.height,
								}
							: e,
					),
				})),
		)
		socket.on('element:deleted', (id: string) => {
			forgetElement(id)
			setState(p => ({ ...p, elements: p.elements.filter(e => e.id !== id) }))
		})
		socket.on('element:zorder', (ids: string[]) =>
			setState(p => {
				const z = new Map(ids.map((id, i) => [id, i]))
				return {
					...p,
					elements: p.elements.map(e => ({
						...e,
						zIndex: z.get(e.id) ?? e.zIndex,
					})),
				}
			}),
		)
		socket.on('elements:cleared', () => {
			forgetAllElements()
			setState(p => ({ ...p, elements: [] }))
		})
		socket.on('widget:updated', (def: WidgetDefinition) => {
			if (!def || typeof def.id !== 'string') return
			setState(p => ({
				...p,
				widgets: { ...(p.widgets || {}), [def.id]: def },
			}))
		})
		socket.on('widget:deleted', (id: string) => {
			setState(p => {
				const widgets = { ...(p.widgets || {}) }
				delete widgets[id]
				return { ...p, widgets }
			})
		})
		socket.on('widget:trigger', (d: any) => {
			window.dispatchEvent(
				new CustomEvent('ovrly:widget-trigger', { detail: d }),
			)
		})
		socket.on('widget:chat', (d: any) => {
			window.dispatchEvent(new CustomEvent('ovrly:widget-chat', { detail: d }))
		})
		socket.on('widget:twitch-event', (d: any) => {
			window.dispatchEvent(
				new CustomEvent('ovrly:widget-twitch-event', { detail: d }),
			)
		})

		return () => {
			socket.disconnect()
		}
	}, [room, userLogin, ghost])

	// курсоры пропадают, если участник перестал двигать мышью или отключился;
	// локи объектов чистятся по истечении TTL
	useEffect(() => {
		const t = setInterval(() => {
			setRemoteCursors(prev =>
				prev.some(p => Date.now() - p.t > 5000)
					? prev.filter(p => Date.now() - p.t <= 5000)
					: prev,
			)
			setElementLocks(prev => {
				const next: typeof prev = {}
				let changed = false
				for (const [id, l] of Object.entries(prev)) {
					if (l.until > Date.now()) next[id] = l
					else changed = true
				}
				return changed ? next : prev
			})
		}, 3000)
		return () => clearInterval(t)
	}, [])

	// отправка позиции мыши на канвасе другим участникам (не чаще ~20 раз/с)
	useEffect(() => {
		const vp = canvasEl
		if (!vp) return
		const send = (x: number, y: number, hidden: boolean) => {
			// невидимка не светит курсором — сервер его всё равно отбросил бы
			if (ghost) return
			const now = performance.now()
			if (!hidden && now - cursorLastSent.current < 50) return
			cursorLastSent.current = now
			socketRef.current?.emit('cursor:move', { x, y, hidden })
		}
		const onMove = (e: PointerEvent) => {
			if (e.pointerType !== 'mouse') return
			const rect = vp.getBoundingClientRect()
			send(
				(e.clientX - rect.left - viewRef.current.x) / viewRef.current.s,
				(e.clientY - rect.top - viewRef.current.y) / viewRef.current.s,
				false,
			)
		}
		const onLeave = () => send(0, 0, true)
		vp.addEventListener('pointermove', onMove)
		vp.addEventListener('pointerleave', onLeave)
		return () => {
			vp.removeEventListener('pointermove', onMove)
			vp.removeEventListener('pointerleave', onLeave)
		}
	}, [canvasEl, ghost])

	const emit = useCallback((event: string, data?: any) => {
		socketRef.current?.emit(event, data)
	}, [])

	useEffect(() => {
		setTheme(
			document.documentElement.classList.contains('light') ? 'light' : 'dark',
		)
	}, [])

	const applyTheme = useCallback((next: 'dark' | 'light') => {
		const root = document.documentElement
		const isLight = root.classList.contains('light')
		if ((next === 'light') === isLight) return
		setTheme(next)
		root.classList.add('theme-anim')
		root.classList.toggle('light', next === 'light')
		try {
			localStorage.setItem('theme', next)
		} catch {}
		window.setTimeout(() => root.classList.remove('theme-anim'), 450)
	}, [])

	// локально применяем мгновенно; на сервер уходит не чаще ~8 раз/с (склейка правок)
	const pendingUpdatesRef = useRef<
		Map<
			string,
			{ partial: Partial<StreamElement>; timer: ReturnType<typeof setTimeout> }
		>
	>(new Map())

	// при размонтировании панели гасим отложенные правки: иначе их таймеры
	// доживали бы до срабатывания и держали замыкания на уже удалённые элементы
	useEffect(() => {
		const pending = pendingUpdatesRef.current
		return () => {
			for (const { timer } of pending.values()) clearTimeout(timer)
			pending.clear()
		}
	}, [])

	// ===== история правок (Ctrl+Z / Ctrl+Y) =====
	// Снимки набора элементов: перед каждым действием пользователя. Копим не чаще
	// раза в 700мс, чтобы перетаскивание и вращение не забивали стек
	const historyRef = useRef<{
		past: StreamElement[][]
		future: StreamElement[][]
	}>({
		past: [],
		future: [],
	})
	const lastHistRef = useRef(0)
	const remember = useCallback(() => {
		const now = Date.now()
		if (now - lastHistRef.current < 700) return
		lastHistRef.current = now
		const h = historyRef.current
		h.past.push(stateRef.current.elements.map(e => ({ ...e })))
		if (h.past.length > 40) h.past.shift()
		h.future.length = 0
	}, [])

	const updateElement = useCallback(
		(id: string, partial: Partial<StreamElement>) => {
			remember()
			setState(p => ({
				...p,
				elements: p.elements.map(e => (e.id === id ? { ...e, ...partial } : e)),
			}))
			const pending = pendingUpdatesRef.current.get(id)
			const merged = { ...(pending?.partial || {}), ...partial }
			if (pending) clearTimeout(pending.timer)
			const timer = setTimeout(() => {
				pendingUpdatesRef.current.delete(id)
				emit('element:update', { id, ...merged })
			}, 120)
			pendingUpdatesRef.current.set(id, { partial: merged, timer })
		},
		[emit],
	)

	// Применение снимка истории: локально сразу, а на сервер уходит разница
	// (добавить/удалить/обновить) — так отмена работает и для остальных клиентов
	const applySnapshot = useCallback(
		(target: StreamElement[]) => {
			const cur = stateRef.current.elements
			const byId = new Map(target.map(e => [e.id, e]))
			for (const el of cur) if (!byId.has(el.id)) emit('element:delete', el.id)
			for (const el of target) {
				const prev = cur.find(c => c.id === el.id)
				if (!prev) {
					emit('element:add', el)
					continue
				}
				const patch: Record<string, unknown> = { id: el.id }
				let changed = false
				for (const k of Object.keys(el) as (keyof StreamElement)[]) {
					if (JSON.stringify(prev[k]) !== JSON.stringify(el[k])) {
						patch[k as string] = el[k]
						changed = true
					}
				}
				if (changed) emit('element:update', patch)
			}
			setState(p => ({ ...p, elements: target.map(e => ({ ...e })) }))
		},
		[emit],
	)

	const undo = useCallback(() => {
		const h = historyRef.current
		const prev = h.past.pop()
		if (!prev) return
		h.future.push(stateRef.current.elements.map(e => ({ ...e })))
		applySnapshot(prev)
	}, [applySnapshot])

	const redo = useCallback(() => {
		const h = historyRef.current
		const next = h.future.pop()
		if (!next) return
		h.past.push(stateRef.current.elements.map(e => ({ ...e })))
		applySnapshot(next)
	}, [applySnapshot])

	// немедленная отправка правки без дебаунса — для финального кадра операции:
	// отложенный таймер той же правки гасим, иначе он перезапишет финал устаревшим
	const flushUpdate = useCallback(
		(id: string, partial: Partial<StreamElement>) => {
			const pending = pendingUpdatesRef.current.get(id)
			if (pending) {
				clearTimeout(pending.timer)
				pendingUpdatesRef.current.delete(id)
			}
			emit('element:update', { id, ...partial })
		},
		[emit],
	)
	// ===== медиа-плееры (YouTube / Twitch / видео) =====
	// Ретрансляция в оверлей. Позиция (seek 1/с) — для ВСЕХ играющих элементов:
	// если держать позицию только выбранного, у остальных на оверлее цель устаревает
	// и дрейф-коррекция мотает их назад по кругу. Звук — по смене состояния.
	//
	// Плей/пауза в оверлей отсюда НЕ ретранслируются: раньше они выводились из смены
	// состояния плеера, и когда браузер сам ставил беззвучное превью на паузу (фоновая
	// вкладка), пауза уезжала на стрим. Теперь play/pause отправляет только mediaToggle —
	// то есть явное действие пользователя.
	// Исключение по позиции — обычные видео: seek по кругу слышно как рывки
	const relayMedia = useCallback(
		(id: string, next: MediaSt, cur?: MediaSt) => {
			const now = performance.now()
			if (
				next.kind !== 'video' &&
				next.st === 1 &&
				now - (lastTimeRelayPerElRef.current.get(id) ?? 0) >= 1000
			) {
				lastTimeRelayPerElRef.current.set(id, now)
				emit('element:command', { id, cmd: 'seek', value: next.t })
			}
			if (id !== selectedIdRef.current) return
			if (cur && next.muted !== cur.muted)
				emit('element:command', { id, cmd: next.muted ? 'mute' : 'unmute' })
			if (cur && next.vol !== cur.vol)
				emit('element:command', { id, cmd: 'volume', value: next.vol })
		},
		[emit],
	)

	const applyMediaState = useCallback(
		(id: string, patch: Partial<MediaSt>) => {
			const cur = mediaStatesRef.current.get(id)
			const base: MediaSt = cur ?? {
				vid: patch.vid ?? '',
				kind: patch.kind ?? 'youtube',
				st: -1,
				t: 0,
				dur: 0,
				muted: true,
				vol: 100,
			}
			// периодические infoDelivery несут только позицию — undefined-поля патча
			// НЕ должны затирать известное состояние (иначе панель «забывает» st/dur)
			const clean: Partial<MediaSt> = {}
			for (const [k, v] of Object.entries(patch))
				if (v !== undefined) (clean as any)[k] = v
			const next: MediaSt = { ...base, ...clean }
			// позиция + время отчёта: по ним панель догоняет оверлей после возврата на вкладку
			if (next.st === 1)
				lastPosRef.current.set(id, { t: next.t, at: Date.now() })
			if (
				cur &&
				cur.vid === next.vid &&
				cur.st === next.st &&
				Math.abs(cur.t - next.t) < 0.25 &&
				Math.abs(cur.dur - next.dur) < 0.5 &&
				cur.muted === next.muted &&
				Math.abs(cur.vol - next.vol) < 1
			)
				return
			const m = new Map(mediaStatesRef.current)
			m.set(id, next)
			mediaStatesRef.current = m
			setMediaStates(m)
			relayMedia(id, next, cur)
		},
		[relayMedia],
	)

	// команда локальному плееру элемента (YT — postMessage, Twitch — SDK,
	// обычное видео — сам DOM-плеер панели)
	const localMediaCommand = useCallback(
		(id: string, cmd: string, value?: number) => {
			const el = stateRef.current.elements.find(x => x.id === id)
			const info = el ? parseMediaUrl(el.src || '') : null
			if (info?.kind === 'youtube') {
				const f = document.querySelector(
					`iframe[data-id="${id}"]`,
				) as HTMLIFrameElement | null
				if (!f?.contentWindow) return
				// handshake перед каждой командой: команды, ушедшие до готовности API,
				// плеер молча игнорирует (handshake сразу перед командой гарантирует доставку)
				f.contentWindow.postMessage(
					JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
					'*',
				)
				const map: Record<string, [string, any[]]> = {
					play: ['playVideo', []],
					pause: ['pauseVideo', []],
					seek: ['seekTo', [value ?? 0, true]],
					volume: ['setVolume', [value ?? 100]],
					mute: ['mute', []],
					unmute: ['unMute', []],
					cc: [value ? 'loadModule' : 'unloadModule', ['captions']],
				}
				const [func, args] = map[cmd] ?? ['', []]
				if (func)
					f.contentWindow.postMessage(
						JSON.stringify({ event: 'command', func, args }),
						'*',
					)
				// YouTube включает субтитры сам (по настройке зрителя или у видео с
				// принудительными субтитрами) — гасим сразу после старта/перемотки,
				// если пользователь не включал их нашей кнопкой
				if (
					(cmd === 'play' || cmd === 'pause' || cmd === 'seek') &&
					ccStatesRef.current.get(id) !== 1
				)
					f.contentWindow.postMessage(
						JSON.stringify({
							event: 'command',
							func: 'unloadModule',
							args: ['captions'],
						}),
						'*',
					)
				return
			}
			// обычное видео (файл с ПК / прямая ссылка): управляем самим <video>
			const v = document.querySelector(
				`video[data-id="${id}"]`,
			) as HTMLVideoElement | null
			if (v) {
				try {
					if (cmd === 'play') void v.play().catch(() => {})
					else if (cmd === 'pause') v.pause()
					else if (cmd === 'seek') v.currentTime = value ?? 0
					else if (cmd === 'volume') {
						v.volume = Math.max(0, Math.min(1, (value ?? 100) / 100))
						if (v.volume > 0) v.muted = false
					} else if (cmd === 'mute') v.muted = true
					else if (cmd === 'unmute') {
						v.muted = false
						if (v.volume === 0) v.volume = 1
					}
				} catch {}
				return
			}
			const p = twitchPlayers.current.get(id)
			if (!p) return
			try {
				if (cmd === 'play') p.play()
				else if (cmd === 'pause') p.pause()
				else if (cmd === 'seek') p.seek(value ?? 0)
				else if (cmd === 'volume') p.setVolume((value ?? 100) / 100)
				else if (cmd === 'mute') p.mute?.()
				else if (cmd === 'unmute') p.unmute?.()
			} catch {}
		},
		[],
	)

	// команда: локальному плееру + сразу в оверлей (для действий плашки)
	const mediaCommand = useCallback(
		(id: string, cmd: string, value?: number) => {
			if (cmd === 'cc') ccStatesRef.current.set(id, value ?? 0)
			localMediaCommand(id, cmd, value)
			emit('element:command', { id, cmd, value })
		},
		[emit, localMediaCommand],
	)

	// плей/пауза (клик по видео и кнопка на плашке): команда уходит сразу и локальному
	// плееру, и в оверлей — намерение пользователя не должно теряться. При буферизации
	// (st=3) повторный клик означает паузу, а не ещё один play
	const mediaToggle = useCallback(
		(id: string) => {
			const stNow = mediaStatesRef.current.get(id)?.st
			const playing =
				stNow === 1 || (stNow === 3 && lastYtCmdRef.current.get(id) === 'play')
			const next: 'play' | 'pause' = playing ? 'pause' : 'play'
			lastYtCmdRef.current.set(id, next)
			localMediaCommand(id, next)
			emit('element:command', { id, cmd: next })
			chromeCtlRefs.current.get(id)?.note()
		},
		[emit, localMediaCommand],
	)

	const registerChromeCtl = useCallback((id: string, ctl: ChromeCtl | null) => {
		if (ctl) chromeCtlRefs.current.set(id, ctl)
		else chromeCtlRefs.current.delete(id)
	}, [])

	// SDK-плеер Twitch смонтирован: подписываемся на события плей/пауза
	const onTwitchPlayer = useCallback((id: string, p: any | null) => {
		if (!p) {
			twitchPlayers.current.delete(id)
			twitchStRef.current.delete(id)
			return
		}
		twitchPlayers.current.set(id, p)
		try {
			const Tw = (window as any).Twitch
			if (Tw?.Player) {
				p.addEventListener(Tw.Player.PLAY, () => {
					twitchStRef.current.set(id, 1)
				})
				p.addEventListener(Tw.Player.PAUSE, () => {
					twitchStRef.current.set(id, 2)
				})
			}
		} catch {}
	}, [])

	// опрос Twitch-плееров: позиция/громкость для плашки и ретрансляции
	useEffect(() => {
		const i = setInterval(() => {
			for (const [id, p] of twitchPlayers.current) {
				try {
					const t = p.getCurrentTime?.() ?? 0
					const dur = p.getDuration?.() ?? 0
					const vol = Math.round((p.getVolume?.() ?? 1) * 100)
					const muted =
						typeof p.isMuted === 'function'
							? !!p.isMuted()
							: (mediaStatesRef.current.get(id)?.muted ?? true)
					const st = twitchStRef.current.get(id) ?? -1
					const el = stateRef.current.elements.find(x => x.id === id)
					const vid = el ? mediaKeyFor(el) : ''
					applyMediaState(id, { vid, kind: 'twitch', st, t, dur, muted, vol })
				} catch {}
			}
		}, 1000)
		return () => clearInterval(i)
	}, [applyMediaState])

	// YouTube-плееры reports: infoDelivery → состояние элемента
	useEffect(() => {
		const onMsg = (e: MessageEvent) => {
			let elId: string | null = null
			const nodes = document.querySelectorAll('iframe[data-id]')
			for (const n of nodes) {
				if ((n as HTMLIFrameElement).contentWindow === e.source) {
					elId = n.getAttribute('data-id')
					break
				}
			}
			if (!elId) return
			try {
				const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
				// initialDelivery приходит после handshake и несёт duration/playerState,
				// infoDelivery — периодические обновления позиции
				if (
					!d ||
					(d.event !== 'infoDelivery' && d.event !== 'initialDelivery') ||
					!d.info
				)
					return
				const info = d.info
				const el = stateRef.current.elements.find(x => x.id === elId)
				if (!el) return
				// отчёты приходят только от YouTube-плееров элементов-медиа
				if (parseMediaUrl(el.src || '')?.kind !== 'youtube') return
				applyMediaState(elId, {
					vid: mediaKeyFor(el),
					kind: 'youtube',
					st: info.playerState,
					t: info.currentTime,
					dur: info.duration,
					muted: info.muted,
					vol: info.volume !== undefined ? Math.round(info.volume) : undefined,
				} as Partial<MediaSt>)
				// ролик закончился — переключаем очередь на следующий.
				// expected защищает от двойного переключения при двух открытых панелях
				if (
					info.playerState === 0 &&
					Array.isArray(el.playlist) &&
					el.playlist.length
				) {
					const now = Date.now()
					const last = playlistStepAtRef.current.get(elId) || 0
					if (now - last > 1500) {
						playlistStepAtRef.current.set(elId, now)
						socketRef.current?.emit('playlist:step', {
							id: elId,
							dir: 1,
							expected: el.playlistIndex ?? 0,
						})
					}
				}
			} catch {}
		}
		window.addEventListener('message', onMsg)
		return () => window.removeEventListener('message', onMsg)
	}, [applyMediaState])

	// YouTube присылает infoDelivery только после handshake. Без него панель
	// не видела окончание ролика и плейлист не переключался на следующее видео.
	// Держим handshake для всех YouTube-элементов, а не только после ручного play.
	useEffect(() => {
		const t = setInterval(() => {
			for (const el of stateRef.current.elements) {
				if (parseMediaUrl(el.src || '')?.kind !== 'youtube') continue
				const f = document.querySelector(
					`iframe[data-id="${el.id}"]`,
				) as HTMLIFrameElement | null
				f?.contentWindow?.postMessage(
					JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
					'*',
				)
			}
		}, 1500)
		return () => clearInterval(t)
	}, [])

	// выбранный играющий элемент раз в 5с подтверждаем оверлею (закрывает рефреш
	// оверлея / переподключение без действий пользователя)
	useEffect(() => {
		const t = setInterval(() => {
			const sel = selectedIdRef.current
			// Субтитры: YouTube включает их сам — глушим у ВСЕХ роликов, чьи субтитры
			// не включал пользователь нашей кнопкой (единственный источник «включено»).
			// Подтверждаем только выключение: если навязывать состояние, субтитры
			// «включаются постоянно» и их нельзя выключить
			for (const [id, mst] of mediaStatesRef.current) {
				if (mst.kind !== 'youtube' || ccStatesRef.current.get(id) === 1)
					continue
				localMediaCommand(id, 'cc', 0)
			}
			if (!sel) return
			const st = mediaStatesRef.current.get(sel)
			if (st?.st === 1) {
				emit('element:command', { id: sel, cmd: 'play' })
				emit('element:command', { id: sel, cmd: 'seek', value: st.t })
				emit('element:command', { id: sel, cmd: st.muted ? 'mute' : 'unmute' })
				emit('element:command', { id: sel, cmd: 'volume', value: st.vol })
				if (st.kind === 'youtube' && ccStatesRef.current.get(sel) !== 1)
					emit('element:command', { id: sel, cmd: 'cc', value: 0 })
			}
		}, 5000)
		return () => clearInterval(t)
	}, [emit, localMediaCommand])

	// Возврат на вкладку: браузер ставит беззвучное превью на паузу, пока страница
	// скрыта, а оверлей в OBS всё это время продолжает играть. Поэтому мало «снова play»:
	// сначала догоняем позицию (последняя известная + сколько прошло), иначе панель
	// начала бы ретранслировать отставшую позицию и утащила бы стрим назад
	useEffect(() => {
		const onVisible = () => {
			if (document.hidden) return
			for (const [id, st] of mediaStatesRef.current) {
				if (st.st !== 2 && st.st !== 3) continue
				const intent = lastYtCmdRef.current.get(id)
				const wantPlaying = intent ? intent === 'play' : st.t > 0.5
				if (!wantPlaying) continue
				const last = lastPosRef.current.get(id)
				const target = last ? last.t + (Date.now() - last.at) / 1000 : st.t
				if (last && Math.abs(target - st.t) > 1.5)
					localMediaCommand(id, 'seek', target)
				localMediaCommand(id, 'play')
			}
		}
		document.addEventListener('visibilitychange', onVisible)
		return () => document.removeEventListener('visibilitychange', onVisible)
	}, [localMediaCommand])

	// интерактив iframe действует только пока выбран именно он
	useEffect(() => {
		if (selectedId !== interactiveIframeId) setInteractiveIframeId(null)
	}, [selectedId, interactiveIframeId])

	// Twitch-превью фоном холста (как в pogly): стрим тянется напрямую с канала через
	// официальный SDK. Оффлайн — Twitch сам показывает арт канала, при эфире — стрим.
	//
	// Почему так: URL-параметры автозапуска ненадёжны (браузер блокирует play() до
	// применения мьюта), поэтому держим НЕОГРАНИЧЕННЫЙ сторож: пока превью включено,
	// раз в 3 секунды проверяем, что плеер реально играет, и будим его. Раньше попытки
	// кончались через 40 секунд, и застрявший на паузе плеер оставался на паузе навсегда.
	// Размер iframe плеера фиксируем в момент включения (Twitch перерисовывается при
	// смене размера — отсюда «двойной рендер» и подвисания), а масштаб вида применяем
	// CSS-трансформом: на телефоне после поворота превью не пересоздаётся и не «раздувается»
	const twitchPreviewRef = useRef<HTMLDivElement | null>(null)
	const twitchPlayerRef = useRef<any>(null)
	// Размер iframe превью в пикселях: задаётся в момент включения и потом НЕ меняется
	// (Twitch перерисовывает плеер при смене размера — отсюда подвисания и «двойной рендер»),
	// а под текущий размер холста подгоняется CSS-трансформом. Считаем от размера бокса
	// на экране, но не меньше 640px по ширине: на телефоне бокс маленький, и плеер
	// в натуральную величину был бы нечитаемым
	const [previewBox, setPreviewBox] = useState<{ w: number; h: number } | null>(
		null,
	)
	// играет ли превью прямо сейчас: пока нет — бокс кликабельный, чтобы можно было
	// нажать встроенную кнопку Twitch (автозапуск браузер может заблокировать)
	const [previewPlaying, setPreviewPlaying] = useState(false)
	// оффлайн/неизвестный статус — не держим превью поверх элементов и не показываем
	// встроенную карточку Twitch «не в сети»: вместо неё будет своя заглушка
	useEffect(() => {
		if (twitchLive !== true) setPreviewPlaying(false)
	}, [twitchLive])

	useEffect(() => {
		if (!previewOn || !channel || !mounted || twitchLive !== true) return
		const target = twitchPreviewRef.current
		if (!target) return
		let cancelled = false
		const timers: ReturnType<typeof setTimeout>[] = []
		let watchdog: ReturnType<typeof setInterval> | null = null

		// ВАЖНО: методы Twitch-плеера возвращают Promise (isPaused, getMuted, play…).
		// Раньше мы сравнивали их результат с boolean напрямую — условие всегда было
		// ложным, поэтому «сторож» ничего не делал и плеер оставался на паузе
		const unwrap = async (v: any) => {
			try {
				return v && typeof v.then === 'function' ? await v : v
			} catch {
				return undefined
			}
		}

		const resumeRef: { current: null | (() => void) } = { current: null }

		;(async () => {
			try {
				const Tw = await loadTwitchSdk()
				if (cancelled || !twitchPreviewRef.current) return
				const player = new Tw.Player('twitch-preview', {
					width: '100%',
					height: '100%',
					channel,
					parent: parentHost,
					autoplay: true,
					muted: true,
				})
				twitchPlayerRef.current = player

				// «разбудить» плеер: сначала гарантированно mute (без него браузер
				// блокирует запуск), затем play(). Оба вызова — синхронно, в том же
				// пользовательском жесте: если сначала await setMuted, play() теряет
				// user activation и браузер оставляет плеер на паузе.
				const resume = () => {
					if (cancelled) return
					try {
						player.setMuted?.(true)
					} catch {}
					try {
						player.play?.()
					} catch {}
				}
				resumeRef.current = resume
				const isPaused = async () => {
					const v = await unwrap(player.isPaused?.())
					// если метод вообще не отдал значение — считаем, что на паузе,
					// и пробуем разбудить (play() на играющем плеере безвреден)
					return v === undefined ? true : v === true
				}

				player.addEventListener(Tw.Player.READY, () => {
					void resume()
				})
				player.addEventListener(Tw.Player.PLAY, () => setPreviewPlaying(true))
				player.addEventListener(Tw.Player.PAUSE, () => {
					setPreviewPlaying(false)
					timers.push(setTimeout(() => void resume(), 600))
				})
				player.addEventListener(Tw.Player.ONLINE, () => void resume())
				if (Tw.Player.PLAYBACK_BLOCKED)
					player.addEventListener(Tw.Player.PLAYBACK_BLOCKED, () => {
						timers.push(setTimeout(() => void resume(), 900))
					})

					// первые быстрые попытки — чтобы стрим поднялся сразу, дальше сторож
				;[250, 800, 1600, 3000, 6000].forEach(d =>
					timers.push(setTimeout(() => void resume(), d)),
				)

				// состояние берём из getPlayerState().playback: isPaused() возвращает false
				// даже когда трансляция ещё не стартовала (playback: 'Ready').
				// ВАЖНО: Twitch иногда отдаёт 'Idle', хотя видео уже играет, поэтому
				// «играет» определяем ещё и по ненулевому currentTime.
				const playbackState = async () => {
					try {
						const st = await unwrap(player.getPlayerState?.())
						return st && typeof st === 'object' ? st : null
					} catch {
						return null
					}
				}
				let lastTime = 0
				const syncPlayback = async () => {
					if (cancelled) return
					const p = twitchPlayerRef.current
					if (!p) return
					const st = await playbackState()
					const playback = typeof st?.playback === 'string' ? st.playback : ''
					const time = Number(st?.currentTime)
					// Twitch иногда отдаёт 'Idle', хотя видео уже играет. Считаем
					// играющим, если время реально продвинулось между проверками:
					// так пауза на середине не принимается за воспроизведение.
					const advanced = Number.isFinite(time) && time > lastTime + 0.05
					const playing =
						playback === 'Playing' ||
						(playback !== 'Paused' && playback !== 'Ready' && advanced)
					if (Number.isFinite(time)) lastTime = time
					setPreviewPlaying(playing)
					if (!playing) await resume()
				}
				watchdog = setInterval(() => void syncPlayback(), 1500)
			} catch {}
		})()

		// страховка для политик автозапуска: любое действие пользователя в панели
		// (клик, клавиша) снимает блокировку — сразу будим плеер
		const onInteract = () => void resumeRef.current?.()
		// фаза перехвата (true): жест должен долетать до плеера даже если обработчик
		// канваса (выделение/панорама) вызывает stopPropagation и глушит всплытие —
		// иначе клик по превью-стриму перестаёт «будить» трансляцию
		window.addEventListener('pointerdown', onInteract, true)
		window.addEventListener('keydown', onInteract, true)

		return () => {
			cancelled = true
			if (watchdog) clearInterval(watchdog)
			timers.forEach(clearTimeout)
			window.removeEventListener('pointerdown', onInteract, true)
			window.removeEventListener('keydown', onInteract, true)
			twitchPlayerRef.current = null
			if (twitchPreviewRef.current) twitchPreviewRef.current.innerHTML = ''
		}
	}, [previewOn, channel, mounted, previewKey, parentHost, twitchLive])

	// статус эфира: пока показан плейсхолдер «не в эфире» — опрашиваем каждые 15 секунд,
	// когда стрим играется — раз в минуту. Значение меняется только на точно известное
	useEffect(() => {
		if (!previewOn || !channel) return
		let stopped = false
		let prev: boolean | null = null
		const tick = async () => {
			try {
				const res = await fetch(
					`/api/twitch-live?channel=${encodeURIComponent(channel)}`,
				)
				const j = await res.json()
				if (stopped) return
				if (j?.live !== true && j?.live !== false) return // неизвестно (нет ключей/сеть) — ничего не меняем
				setTwitchLive(j.live)
				if (prev === false && j.live === true) setPreviewKey(k => k + 1)
				prev = j.live
			} catch {}
		}
		tick()
		let t: ReturnType<typeof setInterval> | null = null
		const schedule = () => {
			t = setInterval(tick, twitchLive === false ? 15000 : 60000)
		}
		schedule()
		return () => {
			stopped = true
			if (t) clearInterval(t)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [previewOn, channel, twitchLive === false])

	const addElement = useCallback(
		(el: Omit<StreamElement, 'id' | 'zIndex' | 'visible'>) => {
			remember()
			emit('element:add', { ...el, visible: true })
		},
		[emit, remember],
	)

	// пробуем натуральный размер картинки, чтобы элемент спавнился без искажений
	const getImageSize = (src: string): Promise<{ w: number; h: number }> =>
		new Promise(resolve => {
			const img = new Image()
			img.onload = () =>
				resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 225 })
			img.onerror = () => resolve({ w: 400, h: 225 })
			img.src = src
		})

	const selected = state.elements.find(e => e.id === selectedId) || null

	// одиночное выделение всегда снимает мультивыделение: иначе одновременно
	// рисуются ручки элемента и бокс группы, и они перехватывают друг друга
	const selectOnly = useCallback((id: string) => {
		setSelectedIds(new Set())
		setSelectedId(id)
	}, [])

	const rotateRef = useRef<{
		el: StreamElement
		cx: number
		cy: number
		startAngle: number
		startRotation: number
	} | null>(null)

	const handleRotateStart = useCallback(
		(e: React.PointerEvent, el: StreamElement) => {
			if (isLockedByOther(el.id)) return
			e.preventDefault()
			e.stopPropagation()
			emit('element:grab', { id: el.id })
			remember()
			if (!viewportRef.current) return
			const rect = viewportRef.current.getBoundingClientRect()
			const { x: vx, y: vy, s } = viewRef.current
			// центр элемента в экранных координатах — вокруг него и вращаем
			const cx = rect.left + vx + (el.x + el.width / 2) * s
			const cy = rect.top + vy + (el.y + el.height / 2) * s
			rotateRef.current = {
				el,
				cx,
				cy,
				startAngle:
					(Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI,
				startRotation: el.rotation ?? 0,
			}
		},
		[],
	)

	const handleRotateMove = useCallback(
		(e: PointerEvent) => {
			const r = rotateRef.current
			if (!r) return
			const cur =
				(Math.atan2(e.clientY - r.cy, e.clientX - r.cx) * 180) / Math.PI
			let rot = r.startRotation + (cur - r.startAngle)
			if (e.shiftKey) {
				rot = Math.round(rot / 15) * 15 // шаг 15° с зажатым Shift
			} else {
				rot = Math.round(rot)
				// «магнит» к 0/90/180/270: почти ровный поворот становится ровно ровным
				const near = Math.round(rot / 90) * 90
				if (Math.abs(rot - near) <= 3) rot = near
			}
			rot = ((rot % 360) + 360) % 360
			updateElement(r.el.id, { rotation: rot })
		},
		[updateElement, isLockedByOther, emit],
	)

	useEffect(() => {
		const fn = () => {
			rotateRef.current = null
		}
		window.addEventListener('pointerup', fn)
		window.addEventListener('pointercancel', fn)
		window.addEventListener('pointermove', handleRotateMove)
		return () => {
			window.removeEventListener('pointerup', fn)
			window.removeEventListener('pointercancel', fn)
			window.removeEventListener('pointermove', handleRotateMove)
		}
	}, [handleRotateMove])

	// на телефоне новые элементы появляются в зоне предзагрузки под экраном,
	// по горизонтали — по центру того, что сейчас видно; на ПК — как раньше (0, 1200).
	// Каскад по уже запаркованным: элементы не ложатся в одну точку стопкой
	// (иначе добавленные подряд два видео неотличимы от «одного загрузившегося»)
	const parkingSpot = (w = 0, h = 0) => {
		const st = stateRef.current
		const k = st.elements.filter(e => e.y > st.canvasH).length % 8
		if (isMobileRef.current) {
			const vp = viewportRef.current
			const { x: vx, s } = viewRef.current
			const cx = vp ? Math.round((vp.clientWidth / 2 - vx) / s - w / 2) : 0
			const x = Math.min(
				Math.max(cx, -200),
				Math.max(-200, st.canvasW - 50 - w),
			)
			return { x: x + k * 40, y: st.canvasH + 120 + k * 24 }
		}
		return { x: k * 40, y: 1200 + k * 24 }
	}

	// добавить экземпляр виджета на холст: код копируется в элемент, библиотека
	// остаётся отдельно — так оверлей получает всё через состояние комнаты
	const addWidgetToCanvas = (def: WidgetDefinition) => {
		const p = parkingSpot(def.width, def.height)
		const widgetValues: Record<string, string> = {}
		for (const v of def.variables || []) widgetValues[v.name] = v.value ?? ''
		addElement({
			type: 'widget',
			widget: def,
			widgetValues,
			...p,
			width: def.width,
			height: def.height,
			text: '',
		})
		setTab('elements')
	}
	const saveWidget = useCallback(
		(def: WidgetDefinition) => emit('widget:save', def),
		[emit],
	)
	const deleteWidget = useCallback(
		(id: string) => emit('widget:delete', id),
		[emit],
	)
	// из свойств элемента: открыть его виджет в редакторе
	const editWidgetFromElement = useCallback((def: WidgetDefinition) => {
		setPendingWidgetEdit(def)
		setSheetOpen(false)
		setTab('widgets')
	}, [])

	// refresh=true — кнопка «Обновить»: сбрасываем кэш на сервере, но сохраняем
	// введённый поиск и выбранную платформу
	const openEmotePicker = useCallback(
		async (refresh = false) => {
			const key = channel || ''
			setEmoteOpen(true)
			setEmoteError('')
			if (!refresh) {
				setEmoteQuery('')
				setEmotePlatform('all')
			}
			// свежий кэш — показываем сразу, без запроса и спиннера
			const cached = refresh ? null : readEmoteCache(key)
			if (cached) {
				setEmotes(cached.emotes)
				setEmoteNotes(cached.notes)
				setEmoteLoading(false)
				if (!cached.emotes.length)
					setEmoteError(
						'Смайлики не найдены. Проверьте TWITCH_CLIENT_ID/SECRET в .env.local или попробуйте позже.',
					)
				return
			}
			if (refresh) clearEmoteCache()
			setEmoteLoading(true)
			try {
				const params = new URLSearchParams()
				if (channel) params.set('channel', channel)
				if (refresh) params.set('refresh', '1')
				const res = await fetch(
					`/api/emotes${params.size ? `?${params.toString()}` : ''}`,
				)
				const j = await res.json()
				if (!res.ok) throw new Error(j?.error || 'Ошибка загрузки')
				setEmotes(j.emotes ?? [])
				setEmoteNotes(j.notes ?? [])
				writeEmoteCache(key, j.emotes ?? [], j.notes ?? [])
				if (!j.emotes?.length)
					setEmoteError(
						'Смайлики не найдены. Проверьте TWITCH_CLIENT_ID/SECRET в .env.local или попробуйте позже.',
					)
			} catch (e: any) {
				setEmoteError(e?.message || 'Не удалось загрузить смайлики')
			} finally {
				setEmoteLoading(false)
			}
		},
		[channel],
	)

	// прогреваем кэш заранее: к моменту первого открытия пикера список уже готов
	useEffect(() => {
		if (!channel || readEmoteCache(channel)) return
		let cancelled = false
		const t = setTimeout(() => {
			const params = new URLSearchParams({ channel })
			fetch(`/api/emotes?${params.toString()}`)
				.then(r => (r.ok ? r.json() : null))
				.then(j => {
					if (cancelled || !Array.isArray(j?.emotes)) return
					writeEmoteCache(channel, j.emotes, j.notes ?? [])
				})
				.catch(() => {})
		}, 1200)
		return () => {
			cancelled = true
			clearTimeout(t)
		}
	}, [channel])

	const addEmote = useCallback(
		(em: Emote) => {
			const p = parkingSpot(96, 96)
			addElement({
				type: 'image',
				src: em.url,
				...p,
				width: 96,
				height: 96,
				text: '',
			})
		},
		[addElement],
	)

	// обработчики добавления — общие для сайдбара и мобильного тулбара.
	// Выбор файла с устройства: input добавляем в DOM (на iOS detached-инпут может
	// не открыть выбор), но обязательно убираем — в том числе при отмене диалога,
	// иначе каждый закрытый «Отмена» оставлял бы узел висеть в body
	const pickFile = useCallback(
		(accept: string, onPick: (f: File) => Promise<void>) => {
			const input = document.createElement('input')
			input.type = 'file'
			input.accept = accept
			input.style.display = 'none'
			let dropped = false
			const drop = () => {
				if (dropped) return
				dropped = true
				input.remove()
			}
			input.addEventListener('cancel', drop)
			input.addEventListener('change', () => {
				const f = input.files?.[0]
				if (!f) {
					drop()
					return
				}
				void onPick(f).finally(drop)
			})
			document.body.appendChild(input)
			input.click()
			// страховка для браузеров без события cancel: окно закрыто, фокус вернулся,
			// файл не выбран — инпут больше не нужен
			window.addEventListener(
				'focus',
				() =>
					setTimeout(() => {
						if (!input.files?.length) drop()
					}, 500),
				{ once: true },
			)
		},
		[],
	)

	const addImagePC = useCallback(() => {
		void pickFile('image/*', async f => {
			const src = await fileToSrc(f)
			const size = await getImageSize(src)
			const k = Math.min(1, 1280 / Math.max(size.w, size.h))
			const w = Math.round(size.w * k),
				h = Math.round(size.h * k)
			const p = parkingSpot(w, h)
			addElement({
				type: 'image',
				src,
				...p,
				width: w,
				height: h,
				text: '',
			})
		})
	}, [addElement, pickFile])

	const addVideoPC = useCallback(() => {
		void pickFile('video/*', async f => {
			if (f.size > 40 * 1024 * 1024) {
				alert('Файл больше 40 МБ. Лучше использовать ссылку.')
				return
			}
			const src = await fileToSrc(f)
			const p = parkingSpot(480, 270)
			addElement({
				type: 'video',
				src,
				...p,
				width: 480,
				height: 270,
				text: '',
			})
		})
	}, [addElement, pickFile])

	// добавление по ссылке — общее для сайдбара на ПК и мобильного шита
	const addImageUrl = useCallback(async () => {
		const url = prompt('Ссылка на картинку:')
		if (!url) return
		const size = await getImageSize(url)
		const k = Math.min(1, 1280 / Math.max(size.w, size.h))
		const p = parkingSpot()
		addElement({
			type: 'image',
			src: url,
			...p,
			width: Math.round(size.w * k),
			height: Math.round(size.h * k),
			text: '',
		})
	}, [addElement])

	const addVideoUrl = useCallback(() => {
		const url = prompt('Ссылка на видео (MP4, WebM):')
		const p = parkingSpot()
		if (url)
			addElement({
				type: 'video',
				src: url,
				...p,
				width: 480,
				height: 270,
				text: '',
			})
	}, [addElement])

	// звук добавляется так же, как картинка/видео: файл с ПК или ссылка.
	// На оверлее он не рисуется — это звуковая кнопка, которой управляют из свойств
	const addAudioPC = useCallback(() => {
		void pickFile('audio/*', async f => {
			if (f.size > 12 * 1024 * 1024) {
				alert('Звук больше 12 МБ. Лучше использовать ссылку.')
				return
			}
			const src = await fileToSrc(f)
			if (src.startsWith('data:') && src.length > 3 * 1024 * 1024) {
				alert(
					'Сервер не смог сохранить звук файлом (слишком большой). Добавьте его по ссылке.',
				)
				return
			}
			const p = parkingSpot(360, 110)
			addElement({
				type: 'audio',
				src,
				...p,
				width: 360,
				height: 110,
				text: '',
				volume: 1,
				loop: false,
			})
		})
	}, [addElement, pickFile])

	const addAudioUrl = useCallback(() => {
		const entered = prompt('Ссылка на звук (MP3, WAV, OGG):')
		const url = entered?.trim()
		if (!url) return
		const srcUrl: string = url
		const p = parkingSpot(360, 110)
		// проверяем, что это действительно аудиофайл, а не страница сайта:
		// иначе браузер молча не сможет воспроизвести элемент
		const probe = new Audio()
		probe.preload = 'metadata'
		let settled = false
		const timer = setTimeout(() => finish(false), 8000)
		function finish(ok: boolean) {
			if (settled) return
			settled = true
			clearTimeout(timer)
			probe.onloadedmetadata = null
			probe.onerror = null
			probe.src = ''
			if (!ok) {
				alert(
					'Не удалось загрузить звук. Нужна прямая ссылка на аудиофайл (MP3/OGG/WAV), а не страница сайта.',
				)
				return
			}
			addElement({
				type: 'audio',
				src: srcUrl,
				...p,
				width: 360,
				height: 110,
				text: '',
				volume: 1,
				loop: false,
			})
		}
		probe.onloadedmetadata = () => finish(true)
		probe.onerror = () => finish(false)
		probe.src = srcUrl
	}, [addElement])

	// YouTube-плейлист: готовый list=... встраиваем нативно (YouTube сам
	// переключает ролики), а несколько отдельных ссылок — очередью, которую
	// переключает сервер после окончания текущего ролика
	const addYoutubePlaylist = useCallback(() => {
		const lines = playlistText
			.split(/\r?\n/)
			.map(s => s.trim())
			.filter(Boolean)
		if (!lines.length) {
			setPlaylistError('Вставьте хотя бы одну ссылку YouTube.')
			return
		}
		const finish = () => {
			setPlaylistOpen(false)
			setPlaylistText('')
			setPlaylistError('')
		}
		// одна ссылка с list=... — это готовый плейлист YouTube: отдаём его
		// самому YouTube, он сам переключит ролики даже без открытой панели
		if (lines.length === 1) {
			const list = youtubePlaylistId(lines[0])
			if (list) {
				const p = parkingSpot(640, 360)
				addElement({
					type: 'iframe',
					src: lines[0],
					...p,
					width: 640,
					height: 360,
					text: '',
					autoplay: true,
				})
				finish()
				return
			}
		}
		const ids: string[] = []
		const lists: string[] = []
		for (const line of lines) {
			const info = parseMediaUrl(line)
			if (info?.kind === 'youtube') {
				if (!ids.includes(info.id)) ids.push(info.id)
				continue
			}
			const list = youtubePlaylistId(line)
			if (list) {
				if (!lists.includes(list)) lists.push(list)
				continue
			}
			setPlaylistError(`Не похоже на ссылку YouTube: ${line.slice(0, 90)}`)
			return
		}
		if (ids.length && lists.length) {
			setPlaylistError(
				'Нельзя смешивать готовый плейлист и отдельные видео. Выберите что-то одно.',
			)
			return
		}
		if (ids.length) {
			const p = parkingSpot(640, 360)
			addElement({
				type: 'iframe',
				src: `https://www.youtube.com/watch?v=${ids[0]}`,
				...p,
				width: 640,
				height: 360,
				text: '',
				autoplay: true,
				playlist: ids.slice(0, 100),
				playlistIndex: 0,
				playlistLoop: playlistLoopNew,
			})
		} else if (lists.length === 1) {
			const p = parkingSpot(640, 360)
			addElement({
				type: 'iframe',
				src: `https://www.youtube.com/playlist?list=${lists[0]}`,
				...p,
				width: 640,
				height: 360,
				text: '',
				autoplay: true,
			})
		} else {
			setPlaylistError(
				lists.length > 1
					? 'Вставьте один готовый плейлист или несколько отдельных видео.'
					: 'Не удалось найти видео в ссылках.',
			)
			return
		}
		finish()
	}, [addElement, playlistText, playlistLoopNew])

	// отдельное явное добавление готового плейлиста по ссылке
	const addReadyYoutubePlaylist = useCallback(() => {
		const url = playlistUrl.trim()
		if (!url) {
			setPlaylistError('Вставьте ссылку готового плейлиста YouTube.')
			return
		}
		if (!youtubePlaylistId(url)) {
			setPlaylistError(
				'В ссылке нет list=... — это не похоже на плейлист YouTube.',
			)
			return
		}
		const p = parkingSpot(640, 360)
		addElement({
			type: 'iframe',
			src: url,
			...p,
			width: 640,
			height: 360,
			text: '',
			autoplay: true,
		})
		setPlaylistOpen(false)
		setPlaylistText('')
		setPlaylistUrl('')
		setPlaylistError('')
	}, [addElement, playlistUrl])

	// drag&drop из проводника: брошенный файл попадает в ЗОНУ ПРЕДЗАГРУЗКИ —
	// так же, как при добавлении через кнопки (не на сам канвас с превью)
	const [dropHover, setDropHover] = useState(false)
	const dragDepth = useRef(0)
	const isImageFile = (f: File) =>
		f.type.startsWith('image/') ||
		/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(f.name)
	const isVideoFile = (f: File) =>
		f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name)
	const isAudioFile = (f: File) =>
		f.type.startsWith('audio/') ||
		/\.(mp3|wav|ogg|oga|aac|m4a|weba)$/i.test(f.name)
	// форматы, которые браузер не воспроизведёт (типичные записи OBS — mkv)
	const UNPLAYABLE_VIDEO_RE = /\.(mkv|avi|flv|ts|wmv)$/i
	const handleDropFiles = useCallback(
		async (files: File[]) => {
			for (const f of files) {
				if (isImageFile(f)) {
					const src = await fileToSrc(f)
					const size = await getImageSize(src)
					const k = Math.min(1, 1280 / Math.max(size.w, size.h))
					const w = Math.round(size.w * k),
						h = Math.round(size.h * k)
					const p = parkingSpot(w, h)
					addElement({
						type: 'image',
						src,
						...p,
						width: w,
						height: h,
						text: '',
					})
				} else if (isVideoFile(f)) {
					if (f.size > 40 * 1024 * 1024) {
						alert(`«${f.name}» больше 40 МБ — добавьте видео по ссылке.`)
						continue
					}
					const src = await fileToSrc(f)
					const p = parkingSpot(480, 270)
					addElement({
						type: 'video',
						src,
						...p,
						width: 480,
						height: 270,
						text: '',
					})
				} else if (isAudioFile(f)) {
					if (f.size > 12 * 1024 * 1024) {
						alert(`«${f.name}» больше 12 МБ — добавьте звук по ссылке.`)
						continue
					}
					const src = await fileToSrc(f)
					if (src.startsWith('data:') && src.length > 3 * 1024 * 1024) {
						alert(
							`«${f.name}» слишком большой для хранения в оверлее — добавьте звук по ссылке.`,
						)
						continue
					}
					const p = parkingSpot(360, 110)
					addElement({
						type: 'audio',
						src,
						...p,
						width: 360,
						height: 110,
						text: '',
						volume: 1,
						loop: false,
					})
				} else if (UNPLAYABLE_VIDEO_RE.test(f.name)) {
					alert(
						`«${f.name}» — браузер не воспроизводит этот формат (частый случай у записей OBS). Конвертируйте в MP4/WebM или добавьте по ссылке.`,
					)
				} else {
					alert(`«${f.name}» — это не картинка, не видео и не звук.`)
				}
			}
		},
		[addElement],
	)

	const addIframeEl = useCallback(() => {
		const p = parkingSpot(560, 315)
		const url = prompt(
			'Ссылка на сайт, YouTube, Twitch, Vimeo или Rutube (например, https://youtube.com/watch?v=...):',
		)
		// обычные видео стоят на превью-заставке (как на референсе) и играют после play,
		// а живые трансляции (канал Twitch, youtube /live/) запускаем сразу — иначе кажется,
		// что «стрим не запускается»
		if (url) {
			// сайты с X-Frame-Options/frame-ancestors в iframe не откроются. Для
			// известных сервисов toEmbedUrl даёт рабочий embed-адрес; для остальных
			// честно предупреждаем, а не оставляем пустую рамку без объяснения
			if (
				!parseMediaUrl(url) &&
				cannotBeFramed(url) &&
				toEmbedUrl(url) === (/^https?:\/\//i.test(url) ? url : `https://${url}`)
			) {
				const ok = confirm(
					'Этот сайт запрещает встраивание в iframe (X-Frame-Options). В рамке он не откроется. Добавьте YouTube, Twitch, Vimeo или Rutube — либо откройте сайт отдельно. Всё равно добавить?',
				)
				if (!ok) return
			}
			addElement({
				type: 'iframe',
				src: url,
				...p,
				width: 560,
				height: 315,
				text: '',
				autoplay: isLiveLink(url),
			})
		}
	}, [addElement])

	// вставка медиа из буфера (Ctrl+V): скриншоты, файлы из проводника, ссылки на картинки и YouTube
	useEffect(() => {
		const onPaste = (e: ClipboardEvent) => {
			// не мешаем вставке текста в поля ввода
			const t = e.target as HTMLElement | null
			if (
				t &&
				(t.tagName === 'INPUT' ||
					t.tagName === 'TEXTAREA' ||
					t.isContentEditable)
			)
				return
			const cd = e.clipboardData
			if (!cd) return
			const files: File[] = []
			for (const it of Array.from(cd.items)) {
				if (it.kind === 'file') {
					const f = it.getAsFile()
					if (f) files.push(f)
				}
			}
			if (files.length) {
				e.preventDefault()
				void handleDropFiles(files)
				return
			}
			// текстом — ссылка: YouTube/Twitch → медиа-элемент, картинка по расширению → картинка
			const text = (cd.getData('text/plain') || '').trim()
			if (!/^https?:\/\//i.test(text)) return
			if (isMediaUrl(text)) {
				e.preventDefault()
				const p = parkingSpot(560, 315)
				addElement({
					type: 'iframe',
					src: text,
					...p,
					width: 560,
					height: 315,
					text: '',
					autoplay: isLiveLink(text),
				})
				return
			}
			if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(text)) {
				e.preventDefault()
				void (async () => {
					try {
						const size = await getImageSize(text)
						const k = Math.min(1, 1280 / Math.max(size.w, size.h))
						const p = parkingSpot()
						addElement({
							type: 'image',
							src: text,
							...p,
							width: Math.round(size.w * k),
							height: Math.round(size.h * k),
							text: '',
						})
					} catch {
						alert('Не удалось загрузить картинку по этой ссылке.')
					}
				})()
			}
		}
		window.addEventListener('paste', onPaste)
		return () => window.removeEventListener('paste', onPaste)
	}, [handleDropFiles, addElement])

	const addTextEl = useCallback(() => {
		const p = parkingSpot(300, 60)
		addElement({
			type: 'text',
			...p,
			width: 300,
			height: 60,
			text: 'Новый текст',
			fontSize: 36,
			color: '#ffffff',
			fontWeight: 'bold',
			bgColor: 'transparent',
		})
	}, [addElement])

	const addTimerEl = useCallback(() => {
		const p = parkingSpot(200, 60)
		addElement({
			type: 'timer',
			...p,
			width: 200,
			height: 60,
			text: '',
			duration: 300,
			timerDirection: 'down',
			fontSize: 40,
			color: '#ffffff',
			fontWeight: 'bold',
			bgColor: 'transparent',
			startTime: null,
			isRunning: false,
			timerLabel: '',
		})
	}, [addElement])

	const dragRef = useRef<{
		id: string
		offX: number
		offY: number
		type: string
		moved: boolean
		sx: number
		sy: number
	} | null>(null)
	// серверная позиция тащимого элемента: если лок перехватили — откатываем элемент сюда
	const dragStartPosRef = useRef<{ id: string; x: number; y: number } | null>(
		null,
	)
	// снимок элемента на старте ресайза — для такого же отката
	const resizeSnapRef = useRef<{ id: string; el: StreamElement } | null>(null)

	const handleDragStart = (e: React.PointerEvent, el: StreamElement) => {
		// замок запрещает тащить, но выделять элемент по-прежнему нужно: на телефоне
		// списка элементов нет, и без выделения заблокированный элемент нельзя
		// ни разблокировать, ни удалить
		if (el.locked) {
			if (e.button !== 0) return
			if (e.shiftKey || e.ctrlKey || e.metaKey) {
				setSelectedIds(prev => {
					const n = new Set(prev)
					if (n.has(el.id)) n.delete(el.id)
					else n.add(el.id)
					return n
				})
				setSelectedId(null)
				return
			}
			if (selectedIdsRef.current.size) setSelectedIds(new Set())
			setSelectedId(el.id)
			return
		}
		if (e.button !== 0) return
		if (isLockedByOther(el.id)) return // объект тащит другой модератор
		// ctrl/shift+клик — добавить/убрать элемент из выделения (без драга)
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			setSelectedIds(prev => {
				const n = new Set(prev)
				if (n.has(el.id)) n.delete(el.id)
				else n.add(el.id)
				return n
			})
			setSelectedId(null)
			return
		}
		// драг выделенного при мультивыделении — двигаем всю группу
		if (selectedIdsRef.current.has(el.id) && selectedIdsRef.current.size > 1) {
			if (isLockedByOther(el.id)) return
			e.preventDefault()
			e.stopPropagation()
			setSelectedId(null)
			const items: { id: string; x: number; y: number }[] = []
			for (const id of selectedIdsRef.current) {
				if (isLockedByOther(id)) continue // заблокированные другими пропускаем
				const it = stateRef.current.elements.find(x => x.id === id)
				if (it && !it.locked) {
					items.push({ id: it.id, x: it.x, y: it.y })
					emit('element:grab', { id: it.id })
				}
			}
			if (items.length < 2) {
				setSelectedIds(new Set())
				return
			}
			remember()
			groupDragRef.current = {
				sx: e.clientX,
				sy: e.clientY,
				dx: 0,
				dy: 0,
				items,
				lastTick: 0,
			}
			document.body.classList.add('dragging')
			return
		}
		// обычный клик по элементу — одиночное выделение
		if (selectedIdsRef.current.size) setSelectedIds(new Set())
		e.preventDefault()
		e.stopPropagation()
		remember()
		emit('element:grab', { id: el.id })
		const { x: vx, y: vy, s } = viewRef.current
		const rect = viewportRef.current!.getBoundingClientRect()
		const lx = (e.clientX - rect.left - vx) / s
		const ly = (e.clientY - rect.top - vy) / s
		dragRef.current = {
			id: el.id,
			offX: lx - el.x,
			offY: ly - el.y,
			type: el.type,
			moved: false,
			sx: e.clientX,
			sy: e.clientY,
		}
		dragStartPosRef.current = { id: el.id, x: el.x, y: el.y }
		if (el.type !== 'iframe') setInteractiveIframeId(null)
		document.body.classList.add('dragging')
		setSelectedId(el.id)
	}

	// оптимистично двигаем локально; на сервер шлём не чаще ~30 раз/с, финал — на mouseup
	const moveThrottleRef = useRef(0)
	const lastMoveRef = useRef<{ id: string; x: number; y: number } | null>(null)
	// групповое перемещение выбранных элементов
	const groupDragRef = useRef<{
		sx: number
		sy: number
		dx: number
		dy: number
		items: { id: string; x: number; y: number }[]
		lastTick: number
	} | null>(null)
	// масштабирование группы за угловую ручку бокса
	// вращение группы выбранных элементов вокруг центра группы
	const groupRotateRef = useRef<{
		cx: number
		cy: number
		startAngle: number
		items: { id: string; cx: number; cy: number; rotation: number }[]
		lastTick: number
	} | null>(null)
	const groupScaleRef = useRef<{
		sx: number
		sy: number
		dx: number
		dy: number
		bx: number
		by: number
		bw: number
		bh: number
		corner: string
		// поворот бокса (град) и его pivot: масштаб считаем в этой системе координат
		rot: number
		pivot: { x: number; y: number }
		// центр рамки в локальной системе pivot — без него неподвижный угол
		// смещён и группа «уезжает» при ресайзе (заметно уже на 3+ элементах)
		centerLocal: { x: number; y: number }
		startLocal: { x: number; y: number }
		items: { id: string; x: number; y: number; w: number; h: number }[]
		lastTick: number
	} | null>(null)

	const handleMouseMove = useCallback(
		(e: PointerEvent) => {
			const { x: vx, y: vy, s } = viewRef.current
			const rect = viewportRef.current?.getBoundingClientRect()
			const gr = groupRotateRef.current
			if (gr && rect) {
				// вращение группы: все выбранные элементы вращаются вокруг центра группы
				const px = (e.clientX - rect.left - vx) / s
				const py = (e.clientY - rect.top - vy) / s
				let ang =
					(Math.atan2(py - gr.cy, px - gr.cx) * 180) / Math.PI - gr.startAngle
				if (e.shiftKey) ang = Math.round(ang / 15) * 15 // шаг 15° с зажатым Shift
				const rad = (ang * Math.PI) / 180
				const c = Math.cos(rad)
				const sn = Math.sin(rad)
				setState(p => ({
					...p,
					elements: p.elements.map(el => {
						const it = gr.items.find(
							(i: { id: string; cx: number; cy: number; rotation: number }) =>
								i.id === el.id,
						)
						if (!it) return el
						const dx = it.cx - gr.cx
						const dy = it.cy - gr.cy
						const ncx = gr.cx + dx * c - dy * sn
						const ncy = gr.cy + dx * sn + dy * c
						const rotation = Math.round(
							(((it.rotation + ang) % 360) + 360) % 360,
						)
						return {
							...el,
							x: Math.round(ncx - el.width / 2),
							y: Math.round(ncy - el.height / 2),
							rotation,
						}
					}),
				}))
				const now = performance.now()
				if (now - gr.lastTick >= 100) {
					gr.lastTick = now
					gr.items.forEach(
						(it: { id: string; cx: number; cy: number; rotation: number }) => {
							const el = stateRef.current.elements.find(x => x.id === it.id)
							if (el)
								updateElement(it.id, {
									x: el.x,
									y: el.y,
									rotation: el.rotation,
								})
						},
					)
				}
				return
			}
			const gs = groupScaleRef.current
			if (gs) {
				// курсор → мировые координаты → система бокса (разворот на -rot вокруг pivot).
				// Дельты считаем в этой системе: тогда ручка точно следует за курсором,
				// даже когда бокс повёрнут вместе с контентом (как в pogly)
				const s = viewRef.current.s || 1
				const rot = (gs.rot * Math.PI) / 180
				const cos = Math.cos(rot)
				const sin = Math.sin(rot)
				const rect = viewportRef.current?.getBoundingClientRect()
				const px = rect ? (e.clientX - rect.left - viewRef.current.x) / s : 0
				const py = rect ? (e.clientY - rect.top - viewRef.current.y) / s : 0
				const lx = (px - gs.pivot.x) * cos + (py - gs.pivot.y) * sin
				const ly = -(px - gs.pivot.x) * sin + (py - gs.pivot.y) * cos
				gs.dx = lx - gs.startLocal.x
				gs.dy = ly - gs.startLocal.y
				let fx = 1
				let fy = 1
				if (gs.corner.includes('e')) fx = (gs.bw + gs.dx) / gs.bw
				if (gs.corner.includes('w')) fx = (gs.bw - gs.dx) / gs.bw
				if (gs.corner.includes('s')) fy = (gs.bh + gs.dy) / gs.bh
				if (gs.corner.includes('n')) fy = (gs.bh - gs.dy) / gs.bh
				fx = Math.max(0.05, Math.min(20, fx))
				fy = Math.max(0.05, Math.min(20, fy))
				// Shift — пропорционально; без Shift масштаб свободный по обеим
				// осям, даже если элементы в группе повёрнуты на разные углы
				if (e.shiftKey) {
					const k = Math.max(fx, fy)
					fx = k
					fy = k
				}
				// неподвижный угол в локальных координатах бокса (origin — pivot);
				// отсчёт от центра рамки, а не от pivot
				const oxL =
					gs.centerLocal.x + (gs.corner.includes('w') ? 1 : -1) * (gs.bw / 2)
				const oyL =
					gs.centerLocal.y + (gs.corner.includes('n') ? 1 : -1) * (gs.bh / 2)
				setState(p => ({
					...p,
					elements: p.elements.map(el => {
						const it = gs.items.find(i => i.id === el.id)
						if (!it) return el
						// центр элемента в локальной системе: сдвиг → разворот → масштаб → обратно
						const ecx = it.x + it.w / 2
						const ecy = it.y + it.h / 2
						const elLx = (ecx - gs.pivot.x) * cos + (ecy - gs.pivot.y) * sin
						const elLy = -(ecx - gs.pivot.x) * sin + (ecy - gs.pivot.y) * cos
						const nLx = oxL + (elLx - oxL) * fx
						const nLy = oyL + (elLy - oyL) * fy
						const ncx = gs.pivot.x + nLx * cos - nLy * sin
						const ncy = gs.pivot.y + nLx * sin + nLy * cos
						const width = Math.max(4, Math.round(it.w * fx))
						const height = Math.max(4, Math.round(it.h * fy))
						return {
							...el,
							x: Math.round(ncx - width / 2),
							y: Math.round(ncy - height / 2),
							width,
							height,
						}
					}),
				}))
				const now = performance.now()
				if (now - gs.lastTick >= 33) {
					gs.lastTick = now
					gs.items.forEach(it => {
						const el = stateRef.current.elements.find(x => x.id === it.id)
						if (el)
							emit('element:resize', {
								id: it.id,
								x: el.x,
								y: el.y,
								width: el.width,
								height: el.height,
							})
					})
				}
				return
			}
			const g = groupDragRef.current
			if (g) {
				// дельта курсора — в экранных пикселях: делим на зум, иначе при
				// отдалении группа ползёт медленнее курсора
				const s = viewRef.current.s || 1
				g.dx = (e.clientX - g.sx) / s
				g.dy = (e.clientY - g.sy) / s
				const { dx, dy } = g
				setState(p => ({
					...p,
					elements: p.elements.map(el => {
						const it = g.items.find(i => i.id === el.id)
						return it
							? { ...el, x: Math.round(it.x + dx), y: Math.round(it.y + dy) }
							: el
					}),
				}))
				const now = performance.now()
				if (now - g.lastTick >= 33) {
					g.lastTick = now
					g.items.forEach(it =>
						emit('element:move', {
							id: it.id,
							x: Math.round(it.x + dx),
							y: Math.round(it.y + dy),
						}),
					)
				}
				return
			}
			if (!dragRef.current || !viewportRef.current || !rect) return
			const lx = (e.clientX - rect.left - vx) / s
			const ly = (e.clientY - rect.top - vy) / s
			if (
				!dragRef.current.moved &&
				(Math.abs(e.clientX - dragRef.current.sx) > 4 ||
					Math.abs(e.clientY - dragRef.current.sy) > 4)
			)
				dragRef.current.moved = true
			const x = Math.round(lx - dragRef.current.offX)
			const y = Math.round(ly - dragRef.current.offY)
			const id = dragRef.current.id
			setState(p => ({
				...p,
				elements: p.elements.map(el => (el.id === id ? { ...el, x, y } : el)),
			}))
			lastMoveRef.current = { id, x, y }
			const now = performance.now()
			if (now - moveThrottleRef.current >= 33) {
				moveThrottleRef.current = now
				emit('element:move', { id, x, y })
			}
		},
		[emit],
	)

	const handleMouseUp = useCallback(() => {
		const gs = groupScaleRef.current
		if (gs) {
			// финальные размеры группы
			gs.items.forEach(it => {
				const el = stateRef.current.elements.find(x => x.id === it.id)
				if (el)
					emit('element:resize', {
						id: it.id,
						x: el.x,
						y: el.y,
						width: el.width,
						height: el.height,
					})
			})
			groupScaleRef.current = null
			document.body.classList.remove('dragging')
			return
		}
		const grt = groupRotateRef.current
		if (grt) {
			// финальный кадр поворота уходит сразу: с дебаунсом последние ~100мс
			// движения могли не доехать до сервера и оверлей показывал бы другой угол
			grt.items.forEach(it => {
				const el = stateRef.current.elements.find(x => x.id === it.id)
				if (el) flushUpdate(it.id, { x: el.x, y: el.y, rotation: el.rotation })
			})
			groupRotateRef.current = null
			document.body.classList.remove('dragging')
			return
		}
		const g = groupDragRef.current
		if (g) {
			// финальная позиция группы
			g.items.forEach(it => {
				const x = Math.round(it.x + g.dx)
				const y = Math.round(it.y + g.dy)
				if (x !== it.x || y !== it.y) emit('element:move', { id: it.id, x, y })
			})
			groupDragRef.current = null
			document.body.classList.remove('dragging')
			return
		}
		const dr = dragRef.current
		if (dr && !dr.moved) {
			if (dr.type === 'video') {
				// клик по видео без перетаскивания — плей/пауза (плеер прозрачен для курсора)
				mediaToggle(dr.id)
			} else if (dr.type === 'iframe') {
				const el = stateRef.current.elements.find(x => x.id === dr.id)
				if (el && isMediaUrl(el.src || '')) {
					// клик по медиа (YouTube/Twitch) — плей/пауза (iframe всегда прозрачен для курсора)
					mediaToggle(dr.id)
				} else {
					// клик по сайту без перетаскивания = активируем интерактив (управление сайтом внутри)
					setInteractiveIframeId(dr.id)
				}
			}
		}
		dragRef.current = null
		document.body.classList.remove('dragging')
		if (lastMoveRef.current) {
			moveThrottleRef.current = 0
			emit('element:move', lastMoveRef.current)
			lastMoveRef.current = null
		}
	}, [emit, mediaToggle])

	// Групповой бокс — в собственной системе координат выбранных элементов (как в pogly):
	// ориентируем его по первому элементу и при повороте группы сохраняем этот угол,
	// чтобы рамка вращалась вместе с контентом и не «дышала» при вращении;
	// ручки прикреплены к боксу и следуют за ним. Даже при разных углах элементов
	// рамка остаётся повёрнутой вместе с группой, а не осевой.
	// Pivot (центр вращения) — центроид центров элементов: он инвариантен относительно
	// вращения группы, поэтому бокс не съезжает во время поворота
	const groupBox = useMemo(() => {
		if (selectedIds.size < 2) return null
		const items = stateRef.current.elements.filter(e => selectedIds.has(e.id))
		if (items.length < 2) return null
		const norm = (r?: number) => (((r ?? 0) % 360) + 360) % 360
		const rot0 = norm(items[0].rotation)
		// pivot: центроид центров — при вращении группы он остаётся на месте
		let gx = 0
		let gy = 0
		for (const e of items) {
			gx += e.x + e.width / 2
			gy += e.y + e.height / 2
		}
		gx /= items.length
		gy /= items.length
		// локальная система: сдвиг в pivot и разворот на -rot0
		const th = (rot0 * Math.PI) / 180
		const cos = Math.cos(th)
		const sin = Math.sin(th)
		let x1 = Infinity
		let y1 = Infinity
		let x2 = -Infinity
		let y2 = -Infinity
		for (const e of items) {
			const ecx = e.x + e.width / 2
			const ecy = e.y + e.height / 2
			// угол элемента относительно рамки группы
			const dth = ((norm(e.rotation) - rot0) * Math.PI) / 180
			const c2 = Math.cos(dth)
			const s2 = Math.sin(dth)
			const hw = e.width / 2
			const hh = e.height / 2
			// центр элемента в системе бокса: сдвиг от pivot, развёрнутый на -th
			const ccx = (ecx - gx) * cos + (ecy - gy) * sin
			const ccy = -(ecx - gx) * sin + (ecy - gy) * cos
			for (const [dx, dy] of [
				[-hw, -hh],
				[hw, -hh],
				[hw, hh],
				[-hw, hh],
			]) {
				// смещение угла вращаем на относительный угол элемента
				const lx = ccx + dx * c2 - dy * s2
				const ly = ccy + dx * s2 + dy * c2
				if (lx < x1) x1 = lx
				if (lx > x2) x2 = lx
				if (ly < y1) y1 = ly
				if (ly > y2) y2 = ly
			}
		}
		const w = x2 - x1
		const h = y2 - y1
		// локальный центр бокса обратно в мир: pivot + R(th)·(локальный центр)
		const lcx = (x1 + x2) / 2
		const lcy = (y1 + y2) / 2
		return {
			cx: gx + lcx * cos - lcy * sin,
			cy: gy + lcx * sin + lcy * cos,
			w,
			h,
			rot: rot0,
			pivot: { x: gx, y: gy },
		}
	}, [state, selectedIds])

	// тянем грань бокса — двигаем группу (тот же groupDrag, что и при драге элемента)
	const startGroupMove = useCallback(
		(e: React.PointerEvent) => {
			if (e.button !== 0) return
			e.preventDefault()
			e.stopPropagation()
			setSelectedId(null)
			const items: { id: string; x: number; y: number }[] = []
			for (const id of selectedIdsRef.current) {
				const it = stateRef.current.elements.find(x => x.id === id)
				if (it && !it.locked && !isLockedByOther(id)) {
					items.push({ id, x: it.x, y: it.y })
					emit('element:grab', { id })
				}
			}
			if (items.length < 2) return
			remember()
			groupDragRef.current = {
				sx: e.clientX,
				sy: e.clientY,
				dx: 0,
				dy: 0,
				items,
				lastTick: 0,
			}
			document.body.classList.add('dragging')
		},
		[emit, isLockedByOther],
	)

	// тянем ручку вращения группы: все выбранные элементы вращаются вокруг центра группы
	const startGroupRotate = useCallback(
		(e: React.PointerEvent) => {
			if (e.button !== 0 || !groupBox || !viewportRef.current) return
			e.preventDefault()
			e.stopPropagation()
			setSelectedId(null)
			const { x: vx, y: vy, s } = viewRef.current
			const rect = viewportRef.current.getBoundingClientRect()
			const px = (e.clientX - rect.left - vx) / s
			const py = (e.clientY - rect.top - vy) / s
			// вращаем вокруг pivot (центроид центров): он не смещается при вращении,
			// поэтому и бокс, и содержимое движутся согласованно, без прыжков
			const cx = groupBox.pivot.x
			const cy = groupBox.pivot.y
			const items: {
				id: string
				cx: number
				cy: number
				rotation: number
			}[] = []
			for (const id of selectedIdsRef.current) {
				const it = stateRef.current.elements.find(x => x.id === id)
				if (it && !it.locked && !isLockedByOther(id))
					items.push({
						id,
						cx: it.x + it.width / 2,
						cy: it.y + it.height / 2,
						rotation: it.rotation ?? 0,
					})
			}
			if (items.length < 2) return
			items.forEach(it => emit('element:grab', { id: it.id }))
			remember()
			groupRotateRef.current = {
				cx,
				cy,
				startAngle: (Math.atan2(py - cy, px - cx) * 180) / Math.PI,
				items,
				lastTick: 0,
			}
			document.body.classList.add('dragging')
		},
		[groupBox, emit, isLockedByOther],
	)

	// тянем угловую ручку бокса — масштабируем всю группу
	const startGroupScale = useCallback(
		(e: React.PointerEvent, corner: string) => {
			if (e.button !== 0 || !groupBox) return
			e.preventDefault()
			e.stopPropagation()
			setSelectedId(null)
			const items: {
				id: string
				x: number
				y: number
				w: number
				h: number
			}[] = []
			for (const id of selectedIdsRef.current) {
				const it = stateRef.current.elements.find(x => x.id === id)
				if (it && !it.locked && !isLockedByOther(id))
					items.push({ id, x: it.x, y: it.y, w: it.width, h: it.height })
			}
			if (items.length < 2) return
			items.forEach(it => emit('element:grab', { id: it.id }))
			remember()
			// Масштаб считаем в СИСТЕМЕ БОКСА: ручка точно следует за курсором.
			// Без Shift обе оси свободные, даже если элементы повёрнуты на разные
			// углы; Shift включает пропорциональное масштабирование.
			const rot = (groupBox.rot * Math.PI) / 180
			const cos = Math.cos(rot)
			const sin = Math.sin(rot)
			// курсор в локальных координатах бокса (origin — pivot)
			const rect = viewportRef.current?.getBoundingClientRect()
			const s = viewRef.current.s || 1
			const px = rect ? (e.clientX - rect.left - viewRef.current.x) / s : 0
			const py = rect ? (e.clientY - rect.top - viewRef.current.y) / s : 0
			const toLocal = (x: number, y: number) => ({
				x: (x - groupBox.pivot.x) * cos + (y - groupBox.pivot.y) * sin,
				y: -(x - groupBox.pivot.x) * sin + (y - groupBox.pivot.y) * cos,
			})
			const start = toLocal(px, py)
			// центр рамки относительно pivot: именно вокруг него строится бокс,
			// а pivot — центроид элементов, поэтому они не совпадают
			const centerLocal = {
				x:
					(groupBox.cx - groupBox.pivot.x) * cos +
					(groupBox.cy - groupBox.pivot.y) * sin,
				y:
					-(groupBox.cx - groupBox.pivot.x) * sin +
					(groupBox.cy - groupBox.pivot.y) * cos,
			}
			groupScaleRef.current = {
				sx: e.clientX,
				sy: e.clientY,
				dx: 0,
				dy: 0,
				bx: 0,
				by: 0,
				bw: groupBox.w,
				bh: groupBox.h,
				corner,
				rot: groupBox.rot,
				pivot: groupBox.pivot,
				centerLocal,
				startLocal: start,
				items,
				lastTick: 0,
			}
			document.body.classList.add('dragging')
		},
		[groupBox, emit, isLockedByOther],
	)

	useEffect(() => {
		window.addEventListener('pointermove', handleMouseMove)
		window.addEventListener('pointerup', handleMouseUp)
		window.addEventListener('pointercancel', handleMouseUp)
		return () => {
			window.removeEventListener('pointermove', handleMouseMove)
			window.removeEventListener('pointerup', handleMouseUp)
			window.removeEventListener('pointercancel', handleMouseUp)
		}
	}, [handleMouseMove, handleMouseUp])

	// горячие клавиши: Delete/Backspace — удалить, стрелки — точный сдвиг (Shift — 10px),
	// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — отмена и повтор
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null
			if (
				t &&
				(t.tagName === 'INPUT' ||
					t.tagName === 'TEXTAREA' ||
					t.tagName === 'SELECT' ||
					t.isContentEditable)
			)
				return

			const mod = e.ctrlKey || e.metaKey
			if (mod && e.code === 'KeyZ') {
				e.preventDefault()
				if (e.shiftKey) redo()
				else undo()
				return
			}
			if (mod && e.code === 'KeyY') {
				e.preventDefault()
				redo()
				return
			}

			const ids = new Set(selectedIdsRef.current)
			if (selectedId) ids.add(selectedId)
			if (!ids.size) return

			if (e.key === 'Delete' || e.key === 'Backspace') {
				e.preventDefault()
				remember()
				ids.forEach(id => emit('element:delete', id))
				setSelectedId(null)
				setSelectedIds(new Set())
				return
			}

			const dirs: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
			}
			const dir = dirs[e.key]
			if (!dir) return
			// стрелки — точный сдвиг: мышью попасть в пиксель почти невозможно.
			// Заблокированные и занятые другим модератором элементы пропускаем
			const movable = stateRef.current.elements.filter(
				el => ids.has(el.id) && !el.locked && !isLockedByOther(el.id),
			)
			if (!movable.length) return
			e.preventDefault()
			const step = e.shiftKey ? 10 : 1
			const moves = movable.map(el => ({
				id: el.id,
				x: el.x + dir[0] * step,
				y: el.y + dir[1] * step,
			}))
			remember()
			setState(p => ({
				...p,
				elements: p.elements.map(el => {
					const m = moves.find(x => x.id === el.id)
					return m ? { ...el, x: m.x, y: m.y } : el
				}),
			}))
			moves.forEach(m => emit('element:move', m))
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [selectedId, emit, undo, redo, remember, isLockedByOther])

	const resizeRef = useRef<{
		id: string
		dir: string
		sx: number
		sy: number
		orig: StreamElement
	} | null>(null)
	const resizeThrottleRef = useRef(0)
	const lastResizeRef = useRef<{
		id: string
		x: number
		y: number
		width: number
		height: number
	} | null>(null)

	const handleResizeStart = (
		e: React.PointerEvent,
		el: StreamElement,
		dir: string,
	) => {
		if (isLockedByOther(el.id)) return
		e.preventDefault()
		e.stopPropagation()
		emit('element:grab', { id: el.id })
		document.body.classList.add('dragging')
		remember()
		resizeRef.current = {
			id: el.id,
			dir,
			sx: e.clientX,
			sy: e.clientY,
			orig: { ...el },
		}
		resizeSnapRef.current = { id: el.id, el: { ...el } }
	}

	const handleResizeMove = useCallback(
		(e: PointerEvent) => {
			if (!resizeRef.current || !viewportRef.current) return
			const { dir, orig } = resizeRef.current
			const { x: vx, y: vy, s } = viewRef.current
			const rect = viewportRef.current.getBoundingClientRect()
			// курсор в мировых координатах
			const px = (e.clientX - rect.left - vx) / s
			const py = (e.clientY - rect.top - vy) / s
			// визуальные оси элемента (поворот + зеркалирование): ресайз тянется вдоль них
			const th = ((orig.rotation ?? 0) * Math.PI) / 180
			const cos = Math.cos(th)
			const sin = Math.sin(th)
			const fx = orig.flipH ? -1 : 1
			const fy = orig.flipV ? -1 : 1
			const axX = fx * cos
			const axY = fx * sin
			const ayX = -fy * sin
			const ayY = fy * cos
			// дельта курсора от начала драга, разложенная на оси элемента
			const dxw = (e.clientX - resizeRef.current.sx) / s
			const dyw = (e.clientY - resizeRef.current.sy) / s
			const lvx = dxw * cos + dyw * sin
			const lvy = -dxw * sin + dyw * cos
			const cx0 = orig.x + orig.width / 2
			const cy0 = orig.y + orig.height / 2
			let width, height, x, y
			const signX = dir.includes('w') ? -1 : dir.includes('e') ? 1 : 0
			const signY = dir.includes('n') ? -1 : dir.includes('s') ? 1 : 0
			if (dir.length === 2 && e.shiftKey) {
				// пропорционально: фиксированный угол — противоположный тянемому
				const fixX =
					cx0 - axX * (orig.width / 2) * signX - ayX * (orig.height / 2) * signY
				const fixY =
					cy0 - axY * (orig.width / 2) * signX - ayY * (orig.height / 2) * signY
				const dvx = (px - fixX) * axX + (py - fixY) * axY
				const dvy = (px - fixX) * ayX + (py - fixY) * ayY
				const k = Math.max(
					Math.abs(dvx) / Math.max(orig.width, 1),
					Math.abs(dvy) / Math.max(orig.height, 1),
					30 / Math.max(orig.width, 1),
					20 / Math.max(orig.height, 1),
				)
				width = Math.max(30, Math.round(orig.width * k))
				height = Math.max(20, Math.round(orig.height * k))
				// центр относительно фиксированного угла
				const ncx =
					fixX + axX * (width / 2) * signX + ayX * (height / 2) * signY
				const ncy =
					fixY + axY * (width / 2) * signX + ayY * (height / 2) * signY
				x = Math.round(ncx - width / 2)
				y = Math.round(ncy - height / 2)
			} else {
				// рост вдоль осей элемента; противоположная грань остаётся на месте —
				// для этого центр смещается на половину прироста вдоль той же оси
				const dW = dir.includes('e') ? lvx : dir.includes('w') ? -lvx : 0
				const dH = dir.includes('s') ? lvy : dir.includes('n') ? -lvy : 0
				width = Math.max(30, Math.round(orig.width + dW))
				height = Math.max(20, Math.round(orig.height + dH))
				const appliedW = width - orig.width
				const appliedH = height - orig.height
				const ncx =
					cx0 + axX * (appliedW / 2) * signX + ayX * (appliedH / 2) * signY
				const ncy =
					cy0 + axY * (appliedW / 2) * signX + ayY * (appliedH / 2) * signY
				x = Math.round(ncx - width / 2)
				y = Math.round(ncy - height / 2)
			}
			setState(p => ({
				...p,
				elements: p.elements.map(el =>
					el.id === orig.id ? { ...el, x, y, width, height } : el,
				),
			}))
			lastResizeRef.current = { id: orig.id, x, y, width, height }
			const now = performance.now()
			if (now - resizeThrottleRef.current >= 33) {
				resizeThrottleRef.current = now
				emit('element:resize', { id: orig.id, x, y, width, height })
			}
		},
		[emit],
	)

	useEffect(() => {
		const fn = () => {
			resizeRef.current = null
			document.body.classList.remove('dragging')
			if (lastResizeRef.current) {
				resizeThrottleRef.current = 0
				emit('element:resize', lastResizeRef.current)
				lastResizeRef.current = null
			}
		}
		window.addEventListener('pointerup', fn)
		window.addEventListener('pointercancel', fn)
		window.addEventListener('pointermove', handleResizeMove)
		return () => {
			window.removeEventListener('pointerup', fn)
			window.removeEventListener('pointercancel', fn)
			window.removeEventListener('pointermove', handleResizeMove)
		}
	}, [handleResizeMove, emit])

	// стартовый вид (и пересчёт базы) при монтировании канваса и при смене размера:
	// на телефоне после поворота вьюпорт может быть ещё 0×0 — тогда масштаб выходил
	// отрицательным, холст зеркалился («всё перевёрнуто»), чёрный бокс превью уезжал
	// за экран, а зум вёл себя странно. Поэтому размеры зажимаем и считаем заново
	useEffect(() => {
		const vp = canvasEl
		if (!vp) return
		const computeBase = () => {
			const vw = Math.max(vp.clientWidth, 320)
			const vh = Math.max(vp.clientHeight, 240)
			if (!isMobileRef.current) {
				const s = Math.min((vw - 80) / state.canvasW, (vh - 80) / state.canvasH)
				return {
					s: Math.max(0.02, s),
					x: (vw - state.canvasW * s) / 2,
					y: (vh - state.canvasH * s) / 2,
				}
			}
			// на телефоне начальный вид показывает и парковку под канвасом:
			// иначе добавленные элементы «далеко от превью», и их приходится долго искать
			const w = state.canvasW + 240
			const h = state.canvasH + 60 + 560
			const s = Math.max(0.02, Math.min((vw - 20) / w, (vh - 20) / h))
			const cx = state.canvasW / 2
			const cy = (state.canvasH - 60 + 560) / 2
			return { s, x: vw / 2 - cx * s, y: vh / 2 - cy * s }
		}
		const apply = () => {
			const prev = baseViewRef.current
			const base = computeBase()
			baseViewRef.current = base
			// двигаем вид, только если пользователь ещё не приближал/не панорамировал
			const untouched =
				!prev ||
				(Math.abs(viewRef.current.s - prev.s) < 0.001 &&
					Math.abs(viewRef.current.x - prev.x) < 2 &&
					Math.abs(viewRef.current.y - prev.y) < 2)
			if (untouched) setView(base)
		}
		apply()
		window.addEventListener('resize', apply)
		window.addEventListener('orientationchange', apply)
		return () => {
			window.removeEventListener('resize', apply)
			window.removeEventListener('orientationchange', apply)
		}
	}, [canvasEl, state.canvasW, state.canvasH])

	useEffect(() => {
		const vp = canvasEl
		if (!vp) return
		const onWheel = (e: WheelEvent) => {
			e.preventDefault()
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
			const { x, y, s } = viewRef.current
			const ns = Math.min(200, Math.max(minScale(), s * factor))
			if (ns === s) return
			const rect = vp.getBoundingClientRect()
			const mx = e.clientX - rect.left,
				my = e.clientY - rect.top
			setView({
				s: ns,
				x: mx - ((mx - x) / s) * ns,
				y: my - ((my - y) / s) * ns,
			})
		}
		vp.addEventListener('wheel', onWheel, { passive: false })
		return () => vp.removeEventListener('wheel', onWheel)
	}, [canvasEl])

	// кнопки зума −/+ : приближение к центру видимой области
	const zoomBy = useCallback((factor: number) => {
		const vp = viewportRef.current
		if (!vp) return
		const { x, y, s } = viewRef.current
		const ns = Math.min(200, Math.max(minScale(), s * factor))
		if (ns === s) return
		const mx = vp.clientWidth / 2,
			my = vp.clientHeight / 2
		setView({ s: ns, x: mx - ((mx - x) / s) * ns, y: my - ((my - y) / s) * ns })
	}, [])

	// панорама и щипок — единая pointer-реализация: работает одинаково мышью и пальцами
	// на всех телефонах (старый вариант на touch-событиях вёл себя по-разному в разных браузерах).
	// Перепривязывается при монтировании канваса (поворот телефона из портретного экрана)
	useEffect(() => {
		const vp = canvasEl
		if (!vp) return
		const pointers = new Map<number, { x: number; y: number }>()
		let marquee: { id: number; x1: number; y1: number } | null = null
		let pan: {
			id: number
			x: number
			y: number
			vx: number
			vy: number
		} | null = null
		let pinch: null | { d0: number; s0: number; vx: number; vy: number } = null

		const cancelOneFingerGestures = () => {
			dragRef.current = null
			rotateRef.current = null
			resizeRef.current = null
			pan = null
			document.body.classList.remove('dragging')
			setPanning(false)
		}

		const startPinch = () => {
			cancelOneFingerGestures()
			const pts = [...pointers.values()]
			if (pts.length < 2) return
			const [a, b] = pts
			pinch = {
				d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
				s0: viewRef.current.s,
				vx: viewRef.current.x,
				vy: viewRef.current.y,
			}
		}

		const down = (e: PointerEvent) => {
			const target = e.target as HTMLElement | null
			const onNoPan = !!target?.closest?.('[data-nopan]')
			const onEl = !!target?.closest?.('[data-elwrap]')
			if (e.button === 1) {
				e.preventDefault()
				e.stopPropagation()
				pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
				pan = {
					id: e.pointerId,
					x: e.clientX,
					y: e.clientY,
					vx: viewRef.current.x,
					vy: viewRef.current.y,
				}
				setPanning(true)
				return
			}
			if (e.button !== 0 || onNoPan) return
			// мышь по пустому холсту — рамка мультивыделения (пан — средняя кнопка/тач)
			if (e.pointerType === 'mouse' && !onEl) {
				e.preventDefault() // без этого браузер выделяет текст под рамкой
				const rect = vp.getBoundingClientRect()
				marquee = {
					id: e.pointerId,
					x1: e.clientX - rect.left,
					y1: e.clientY - rect.top,
				}
				setMarquee({
					x1: marquee.x1,
					y1: marquee.y1,
					x2: marquee.x1,
					y2: marquee.y1,
				})
				return
			}
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
			if (pointers.size === 2) {
				// второй палец — щипок, гасим драг/поворот/ресайз и панораму
				startPinch()
			} else if (pointers.size === 1 && !onEl) {
				// палец/клик по пустому месту холста — панорама
				pan = {
					id: e.pointerId,
					x: e.clientX,
					y: e.clientY,
					vx: viewRef.current.x,
					vy: viewRef.current.y,
				}
				setPanning(true)
			}
		}

		const move = (e: PointerEvent) => {
			if (marquee && e.pointerId === marquee.id) {
				const rect = vp.getBoundingClientRect()
				setMarquee(m =>
					m ? { ...m, x2: e.clientX - rect.left, y2: e.clientY - rect.top } : m,
				)
				return
			}
			const pt = pointers.get(e.pointerId)
			if (!pt) return
			pt.x = e.clientX
			pt.y = e.clientY
			if (pinch && pointers.size >= 2) {
				const pts = [...pointers.values()]
				const [a, b] = pts
				const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
				const rect = vp.getBoundingClientRect()
				const mx = (a.x + b.x) / 2 - rect.left
				const my = (a.y + b.y) / 2 - rect.top
				const ns = Math.min(
					200,
					Math.max(minScale(), pinch.s0 * (d / pinch.d0)),
				)
				setView({
					s: ns,
					x: mx - ((mx - pinch.vx) / pinch.s0) * ns,
					y: my - ((my - pinch.vy) / pinch.s0) * ns,
				})
				return
			}
			if (pan && e.pointerId === pan.id) {
				const p = pan
				setView(v => ({
					...v,
					x: p.vx + (e.clientX - p.x),
					y: p.vy + (e.clientY - p.y),
				}))
			}
		}

		const up = (e: PointerEvent) => {
			if (marquee && e.pointerId === marquee.id) {
				const m = marquee
				marquee = null
				const rect = vp.getBoundingClientRect()
				setMarquee(null)
				// отменяем совместимые mouse-события: иначе следующий click по холсту
				// сразу стирает только что сделанное выделение
				e.preventDefault()
				// экран -> мир
				const s = viewRef.current.s
				const wx1 =
					(Math.min(m.x1, e.clientX - rect.left) - viewRef.current.x) / s
				const wy1 =
					(Math.min(m.y1, e.clientY - rect.top) - viewRef.current.y) / s
				const wx2 =
					(Math.max(m.x1, e.clientX - rect.left) - viewRef.current.x) / s
				const wy2 =
					(Math.max(m.y1, e.clientY - rect.top) - viewRef.current.y) / s
				if (wx2 - wx1 < 5 && wy2 - wy1 < 5) {
					// клик по пустому — снять выделение
					setSelectedIds(new Set())
					return
				}
				const hits = stateRef.current.elements
					.filter(
						el =>
							el.visible !== false &&
							el.x < wx2 &&
							el.x + el.width > wx1 &&
							el.y < wy2 &&
							el.y + el.height > wy1,
					)
					.map(el => el.id)
				setSelectedIds(new Set(hits))
				if (hits.length) setSelectedId(null)
				return
			}
			pointers.delete(e.pointerId)
			if (pan && e.pointerId === pan.id) {
				pan = null
				setPanning(false)
			}
			if (pinch && pointers.size < 2) pinch = null
			// после щипка не возобновляем панораму до нового касания
		}

		vp.addEventListener('pointerdown', down)
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
		window.addEventListener('pointercancel', up)
		return () => {
			vp.removeEventListener('pointerdown', down)
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			window.removeEventListener('pointercancel', up)
		}
	}, [canvasEl])

	// вертикальная ориентация телефона — просим повернуть (как на референсе)
	if (isPortrait) {
		return (
			<div className='min-h-[100dvh] bg-bg flex items-center justify-center p-6'>
				<div className='bg-panel border border-border rounded-2xl p-8 text-center max-w-xs w-full'>
					<div className='text-5xl mb-4'>📱</div>
					<h1 className='text-lg font-semibold mb-2'>
						Поверните телефон горизонтально
					</h1>
					<p className='text-sm text-gray-400 mb-5'>
						Панели нужно широкое поле для работы с оверлеем
					</p>
				</div>
			</div>
		)
	}

	// пилюля Превью: на ПК и мобильном — закреплена в правом нижнем углу окна превью.
	// Плеер рендерится ОДИН РАЗ в фиксированном размере (previewBox) и визуально
	// уменьшается только CSS-transform'ом вместе с холстом: iframe никогда не меняет
	// размер — Twitch-плеер не перерисовывается при зуме и не глючит
	const previewPill = (
		<div
			className='absolute right-4 bottom-3 z-10 flex items-center gap-2 bg-panel border border-border rounded-full pl-3 pr-3 py-1.5 pointer-events-auto'
			// ниже окна чата (z-30): Twitch блокирует чат владельцу/модератору,
			// если на странице есть элементы с z-index выше iframe, даже без перекрытия
			style={{ boxShadow: '0 2px 10px rgba(0,0,0,.25)', zIndex: 20 }}
			data-nopan='1'
			onPointerDown={e => e.stopPropagation()}
		>
			<span className='text-xs text-gray-300 select-none'>Превью</span>
			<button
				onClick={() => {
					if (!previewOn) {
						// размер плеера задаём один раз при включении: от текущего размера бокса,
						// но не меньше 640px по ширине — иначе на телефоне плеер был бы нечитаемым
						const boxW = Math.round(
							stateRef.current.canvasW * (viewRef.current.s || 0.3),
						)
						const w = Math.min(1920, Math.max(640, boxW))
						setPreviewBox({
							w,
							h: Math.round(
								(w * stateRef.current.canvasH) / stateRef.current.canvasW,
							),
						})
					}
					setPreviewOn(v => !v)
				}}
				disabled={!channel}
				title={
					channel
						? 'Стрим Twitch в превью холста'
						: 'Вход не выполнен: превью доступно после входа через Twitch'
				}
				className={`w-9 h-5 rounded-full transition-colors shrink-0 relative ${previewOn ? 'bg-green-500' : 'bg-gray-600'} ${channel ? '' : 'opacity-50 cursor-not-allowed'}`}
			>
				<span
					className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
					style={{ left: previewOn ? 18 : 2 }}
				/>
			</button>
		</div>
	)

	// быстрый переключатель чата в правом верхнем углу холста — как «Превью»,
	// но сверху; сама вкладка чата остаётся отдельной
	const chatPill = (
		<div
			className='absolute right-4 top-3 z-10 flex items-center gap-2 bg-panel border border-border rounded-full pl-3 pr-3 py-1.5 pointer-events-auto'
			// ниже окна чата (z-30) — иначе Twitch считает чат перекрытым
			style={{ boxShadow: '0 2px 10px rgba(0,0,0,.25)', zIndex: 20 }}
			data-nopan='1'
			onPointerDown={e => e.stopPropagation()}
		>
			<MessageCircle
				size={14}
				className={chatOn ? 'text-accent2' : 'text-gray-500'}
			/>
			<span className='text-xs text-gray-300 select-none'>Чат</span>
			<button
				role='switch'
				aria-checked={chatOn}
				aria-label='Чат стрима'
				onClick={toggleChat}
				title={chatOn ? 'Скрыть чат' : 'Показать чат'}
				className={`w-9 h-5 rounded-full transition-colors shrink-0 relative ${chatOn ? 'bg-green-500' : 'bg-gray-600'}`}
			>
				<span
					className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
					style={{ left: chatOn ? 18 : 2 }}
				/>
			</button>
		</div>
	)

	return (
		<div className='h-[100dvh] overflow-hidden flex flex-col bg-bg app-shell'>
			{accessRevoked && (
				<div className='fixed inset-0 z-[200] bg-bg flex flex-col items-center justify-center text-center px-4'>
					<div className='text-5xl mb-4'>🚫</div>
					<h1 className='text-xl font-semibold text-[color:var(--c-on-bg)] mb-2'>
						Доступ отозван
					</h1>
					<p className='text-sm text-gray-500 max-w-sm mb-6'>
						Стример отозвал доступ к панели. Обновите страницу, чтобы проверить
						доступ ещё раз.
					</p>
					<a href='/' className='text-sm text-accent2 hover:underline'>
						На главную
					</a>
				</div>
			)}
			{/* предупреждение от админа (например, о скором обновлении) */}
			{notice && (
				<div className='panel-notice'>
					<span className='shrink-0'>📢</span>
					<span className='flex-1'>{notice}</span>
					<button
						onClick={() => setNotice(null)}
						title='Скрыть'
						className='panel-notice-close'
					>
						✕
					</button>
				</div>
			)}
			{/* сервер не подтвердил сессию: правки не сохраняются — говорим об этом явно */}
			{readOnly && !accessRevoked && (
				<div className='px-5 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-900/40'>
					Сессия Twitch не подтверждена — изменения не сохраняются. Обновите
					страницу и войдите заново.
				</div>
			)}
			<header
				className={`flex items-center gap-3 bg-panel border-b border-border panel-header ${isMobile ? 'px-3 py-2' : 'px-5 py-3'}`}
			>
				{isMobile && (
					<button
						onClick={() =>
							menuOpen && !menuClosing ? closeBurger() : openBurger()
						}
						aria-label='Меню'
						className='w-9 h-9 rounded-lg bg-border hover:bg-gray-600 flex flex-col items-center justify-center gap-[3px] shrink-0'
					>
						<span className='block w-4 h-[2px] bg-gray-300 rounded-sm' />
						<span className='block w-4 h-[2px] bg-gray-300 rounded-sm' />
						<span className='block w-4 h-[2px] bg-gray-300 rounded-sm' />
					</button>
				)}
				<a
					href='/'
					className='flex items-center gap-2 hover:opacity-80 transition-opacity'
				>
					<LogoMark size={isMobile ? 28 : 36} />
					<div>
						<h1
							className={`${isMobile ? 'text-sm' : 'text-base'} font-semibold leading-tight`}
						>
							Ovrly
						</h1>
						<p
							className={`${isMobile ? 'text-[10px]' : 'text-xs'} text-gray-500 leading-tight`}
						>
							Панель модератора
						</p>
					</div>
				</a>
				{/* Чей это оверлей: модератор может вести несколько панелей у разных
				    стримеров — канал видно сразу, а места плашка почти не занимает */}
				{channel && (
					<span
						title={`Оверлей канала ${channel}${
							userLogin ? ` · вы вошли как ${userLogin}` : ''
						}`}
						className={`flex items-center gap-1.5 rounded-full border border-border bg-bg text-gray-300 shrink-0 max-w-[30vw] ${
							isMobile ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
						}`}
					>
						<svg
							viewBox='0 0 24 24'
							fill='#9146FF'
							width={isMobile ? 11 : 13}
							height={isMobile ? 11 : 13}
							aria-hidden='true'
							className='shrink-0'
						>
							<path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z' />
						</svg>
						<span className='truncate font-medium'>{channel}</span>
					</span>
				)}
				{/* невидимый вход: видно только самому администратору, другим участникам — нет */}
				{ghost && (
					<span
						title='Невидимый режим: вас нет в списке участников и не видно курсор'
						className={`flex items-center gap-1 rounded-full border border-fuchsia-900/60 bg-fuchsia-950/40 text-fuchsia-300 shrink-0 ${
							isMobile ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
						}`}
					>
						👻 <span className='font-medium'>невидимка</span>
					</span>
				)}
				<div className='flex-1' />
				{isMobile && (
					<button
						onClick={() => setUsersOpen(v => !v)}
						title='Кто сейчас на странице'
						aria-label='Кто сейчас на странице'
						className='relative w-8 h-8 rounded-lg bg-border flex items-center justify-center text-gray-300 shrink-0'
					>
						<UsersIcon size={15} />
						{users.filter(u => u.role !== 'guest').length > 0 && (
							<span className='absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-accent text-white text-[9px] leading-[15px] text-center'>
								{users.filter(u => u.role !== 'guest').length}
							</span>
						)}
					</button>
				)}

				<div className={`flex items-center gap-3 ${isMobile ? 'hidden' : ''}`}>
					{/* кто сейчас на странице: ники и роли (камера — автор панели, меч — модератор) */}
					<button
						onClick={() => setUsersOpen(v => !v)}
						title='Кто сейчас на странице'
						aria-label='Кто сейчас на странице'
						className='relative w-9 h-9 rounded-full bg-border flex items-center justify-center text-gray-300 hover:text-white transition-colors'
					>
						<UsersIcon />
						{users.filter(u => u.role !== 'guest').length > 0 && (
							<span className='absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center'>
								{users.filter(u => u.role !== 'guest').length}
							</span>
						)}
					</button>
					<button
						onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
						title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
						aria-label={
							theme === 'dark'
								? 'Включить светлую тему'
								: 'Включить тёмную тему'
						}
						className={`w-9 h-9 rounded-full bg-border flex items-center justify-center transition-colors ${theme === 'dark' ? 'text-gray-300 hover:text-white' : 'text-[#443f66] hover:text-[#3a3750]'}`}
					>
						{theme === 'dark' ? <SunIcon /> : <MoonIcon />}
					</button>
					<span
						className={`flex items-center gap-1.5 text-sm ${connected ? 'text-green-400' : 'text-red-400'}`}
					>
						<span
							className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
						/>
						{connected ? 'Сервер: онлайн' : 'Сервер: оффлайн'}
					</span>
					<a
						href='https://dalink.to/jettle_'
						target='_blank'
						rel='noopener noreferrer'
						className='text-sm text-accent2 hover:underline'
					>
						Поддержать проект ❤️
					</a>
				</div>
			</header>

			<div
				className={`flex gap-1 px-5 pt-3 bg-panel border-b border-border ${isMobile ? 'hidden' : ''}`}
			>
				<button
					onClick={() => setTab('elements')}
					className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === 'elements' ? 'bg-bg text-[color:var(--c-on-bg)] border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'}`}
				>
					Элементы оверлея
				</button>
				<button
					onClick={() => setTab('widgets')}
					className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === 'widgets' ? 'bg-bg text-[color:var(--c-on-bg)] border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'}`}
				>
					<Blocks size={15} />
					Виджеты
				</button>
				{showObsTab && (
					<button
						onClick={() => setTab('obs')}
						className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === 'obs' ? 'bg-bg text-[color:var(--c-on-bg)] border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'}`}
					>
						Управление OBS
					</button>
				)}
				<button
					onClick={() => setTab('settings')}
					className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-lg transition-colors ${tab === 'settings' ? 'bg-bg text-[color:var(--c-on-bg)] border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'}`}
				>
					<Settings size={15} />
					Настройки
				</button>
			</div>

			<div
				className={`flex-1 flex overflow-hidden ${tab === 'elements' ? '' : 'hidden'}`}
			>
				{!isMobile && !betaUI && sidebarOpen && (
					<aside className='w-72 shrink-0 bg-panel border-r border-border p-4 overflow-y-auto'>
						<div className='flex items-center justify-between mb-3'>
							<h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide'>
								Добавить элемент
							</h2>
							{/* скрывает ВСЮ левую панель: канвас получает всё место */}
							<button
								onClick={toggleSidebar}
								title='Скрыть панель — освободить место'
								className='w-7 h-7 shrink-0 rounded-lg bg-bg border border-border hover:bg-border text-gray-300 flex items-center justify-center text-sm transition-colors'
							>
								‹
							</button>
						</div>
						<div className='space-y-2'>
							<div className='grid grid-cols-3 gap-2'>
								<button
									onClick={() => setAddSheet('image')}
									title='Картинка'
									aria-label='Картинка'
									className='h-10 flex items-center justify-center bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors'
								>
									<ImagePlus size={18} />
								</button>
								<button
									onClick={() => setAddSheet('video')}
									title='Видео'
									aria-label='Видео'
									className='h-10 flex items-center justify-center bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors'
								>
									<Film size={18} />
								</button>
								<button
									onClick={() => setAddSheet('audio')}
									title='Звук'
									aria-label='Звук'
									className='h-10 flex items-center justify-center bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors'
								>
									<Volume2 size={18} />
								</button>
							</div>
							<button
								onClick={() => openEmotePicker()}
								className='w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
							>
								<Smile size={16} />
								Добавить смайлик
							</button>
							<button
								onClick={addIframeEl}
								className='w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
							>
								<Globe size={16} />
								Сайт
							</button>
							<button
								onClick={() => setWidgetPickerOpen(true)}
								title='Добавить виджет на холст'
								className='w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
							>
								<Blocks size={16} />
								Виджеты
							</button>
							<button
								onClick={() => {
									setPlaylistOpen(true)
									setPlaylistError('')
								}}
								className='w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
							>
								<ListVideo size={16} />
								YouTube плейлист
							</button>
							<div className='grid grid-cols-2 gap-2'>
								<button
									onClick={addTimerEl}
									className='flex items-center justify-center gap-1.5 px-2 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
								>
									<Timer size={16} />
									Таймер
								</button>
								<button
									onClick={addTextEl}
									className='flex items-center justify-center gap-1.5 px-2 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
								>
									<Type size={16} />
									Текст
								</button>
							</div>
						</div>

						{/* «Очистить всё» — в шапке списка, а не под ним: при большом
						    количестве элементов кнопку не приходится искать прокруткой */}
						<div className='flex items-center justify-between mt-6 mb-2 gap-2'>
							<h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide'>
								Элементы ({state.elements.length})
							</h2>
							{state.elements.length > 0 && (
								<button
									onClick={() => {
										if (confirm('Очистить все элементы?')) {
											remember()
											emit('elements:clear')
										}
									}}
									title='Очистить все элементы'
									className='px-2 py-1 text-[10px] rounded-md border border-red-900/50 text-red-400 hover:bg-red-950/40 transition-colors shrink-0'
								>
									Очистить
								</button>
							)}
						</div>
						{/* Сетка в 2 столбца: у картинок и видео видно само превью,
						    а не «data:image/png;base64...» в подписи */}
						<div className='grid grid-cols-2 gap-2'>
							{state.elements.map(el => (
								<ElementCard
									key={el.id}
									el={el}
									selected={selectedId === el.id}
									active={selectedIds.has(el.id)}
									onSelect={() => selectOnly(el.id)}
									onToggleVisible={() => {
										setState(p => ({
											...p,
											elements: p.elements.map(x =>
												x.id === el.id ? { ...x, visible: !x.visible } : x,
											),
										}))
										emit('element:toggle-visible', el.id)
									}}
									onDelete={() => {
										remember()
										emit('element:delete', el.id)
										if (selectedId === el.id) setSelectedId(null)
									}}
								/>
							))}
						</div>
						{state.elements.length === 0 && (
							<p className='text-xs text-gray-600 px-2 py-4'>
								Нет элементов. Добавьте сверху.
							</p>
						)}
					</aside>
				)}

				<div className='flex-1 flex flex-col bg-bg overflow-hidden'>
					<div
						ref={setViewportEl}
						className={`flex-1 relative overflow-clip ${panning ? 'cursor-grabbing' : ''}`}
						style={{
							touchAction: 'none',
							background: 'var(--c-canvas)',
							backgroundImage:
								'radial-gradient(var(--c-dot) 1px, transparent 1px)',
							backgroundSize: `${Math.max(4, 22 * view.s)}px ${Math.max(4, 22 * view.s)}px`,
							backgroundPosition: `${view.x}px ${view.y}px`,
						}}
						onClick={e => {
							if (e.target === e.currentTarget) {
								setSelectedId(null)
								setInteractiveIframeId(null)
								// selectedIds здесь НЕ чистим: браузерный click после рамки
								// стирал бы только что сделанное выделение; рамка сама
								// снимает выделение кликом без движения
							}
						}}
						onDragEnter={e => {
							e.preventDefault()
							dragDepth.current += 1
							setDropHover(true)
						}}
						onDragOver={e => {
							e.preventDefault()
							if (!dropHover) setDropHover(true)
						}}
						onDragLeave={e => {
							dragDepth.current = Math.max(0, dragDepth.current - 1)
							if (dragDepth.current === 0) setDropHover(false)
						}}
						onDrop={e => {
							e.preventDefault()
							dragDepth.current = 0
							setDropHover(false)
							if (e.dataTransfer.files?.length) {
								void handleDropFiles([...e.dataTransfer.files])
								return
							}
							// перетаскивание картинки-ссылки из браузера — тоже в зону предзагрузки
							const url = (
								e.dataTransfer.getData('text/uri-list') ||
								e.dataTransfer.getData('text/plain')
							).trim()
							if (/^https?:\/\//i.test(url)) {
								void getImageSize(url).then(size => {
									const k = Math.min(1, 1280 / Math.max(size.w, size.h))
									const p = parkingSpot(
										Math.round(size.w * k),
										Math.round(size.h * k),
									)
									addElement({
										type: 'image',
										src: url,
										...p,
										width: Math.round(size.w * k),
										height: Math.round(size.h * k),
										text: '',
									})
								})
							}
						}}
					>
						{/* фон канваса + превью: ВНЕ transform-контейнера (transform предка блокирует
                  автовоспроизведение Twitch-плеера). Чёрный бокс = границы холста, скейлится
                  с зумом. Плеер внутри рендерится ОДИН РАЗ в размере 100%-зума и визуально
                  сжимается transform'ом вместе с боксом: iframe никогда не меняет размер,
                  Twitch-плеер не перерисовывается при зуме и не глючит */}
						<div
							className='absolute bg-black border border-border rounded-md pointer-events-none overflow-hidden'
							style={{
								left: view.x,
								top: view.y,
								width: state.canvasW * view.s,
								height: state.canvasH * view.s,
							}}
						>
							{mounted &&
								previewOn &&
								channel &&
								previewBox &&
								twitchLive === true && (
									<div
										style={{
											position: 'relative',
											width: previewBox.w,
											height: previewBox.h,
											// Пока превью на паузе, клики должны доходить до самого
											// Twitch-плеера: браузер разрешает запуск только по жесту
											// внутри iframe, программный play() блокируется. На паузе
											// поднимаем плеер над элементами (но ниже ручек группы),
											// чтобы его кнопка Play не была перекрыта картинкой. Как
											// только пошло воспроизведение — слой снова прозрачен для
											// мыши и уходит под элементы.
											pointerEvents: previewPlaying ? 'none' : 'auto',
											zIndex: previewPlaying ? undefined : 1500,
											// масштаб считаем от текущего размера бокса: превью всегда
											// ровно в размер холста (на телефоне — тоже), без пересоздания iframe
											transform: `scale(${(state.canvasW * view.s) / previewBox.w})`,
											transformOrigin: '0 0',
										}}
									>
										<div
											key={previewKey}
											ref={twitchPreviewRef}
											id='twitch-preview'
											className='absolute inset-0'
										/>
									</div>
								)}
							{/* оффлайн/неизвестный статус: своя аккуратная заглушка вместо
							    белой карточки Twitch. Слой не перехватывает мышь, поэтому
							    элементы под ним остаются доступными */}
							{mounted &&
								previewOn &&
								channel &&
								previewBox &&
								twitchLive !== true && (
									<div className='preview-offline' aria-hidden='true'>
										<div className='preview-offline-card'>
											<span
												className={`preview-offline-dot ${twitchLive === null ? 'checking' : 'offline'}`}
											/>
											<div>
												<p className='preview-offline-title'>
													{twitchLive === null
														? 'Проверяем эфир…'
														: `${channel} сейчас не в сети`}
												</p>
												<p className='preview-offline-text'>
													{twitchLive === null
														? 'Как только статус станет известен, превью включится само.'
														: 'Превью появится автоматически, когда стрим начнётся.'}
												</p>
											</div>
										</div>
									</div>
								)}
							{/* пока превью не заиграло (браузер ждёт клика) — подсказка поверх кадра */}
							{mounted &&
								previewOn &&
								channel &&
								previewBox &&
								twitchLive === true &&
								!previewPlaying && (
									<div
										className='absolute left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1.5 pointer-events-none'
										style={{
											top: 'calc(50% - 14px)',
											background: 'rgba(0,0,0,.72)',
											color: '#fff',
											fontSize: 12,
											whiteSpace: 'nowrap',
										}}
									>
										<span>▶</span>
										<span>Нажмите на плеер, чтобы запустить трансляцию</span>
									</div>
								)}
							{!(mounted && previewOn && channel) && (
								<div
									className='absolute inset-0 opacity-10'
									style={{
										backgroundImage:
											'linear-gradient(#444 1px, transparent 1px), linear-gradient(90deg, #444 1px, transparent 1px)',
										backgroundSize: `${40 * view.s}px ${40 * view.s}px`,
									}}
								/>
							)}
						</div>
						<div
							className='absolute left-0 top-0'
							style={{
								transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
								transformOrigin: '0 0',
							}}
						>
							<span
								className='absolute text-center tracking-widest text-gray-600 uppercase pointer-events-none'
								style={{
									left: 0,
									top: -175,
									width: state.canvasW,
									fontSize: 28,
								}}
							>
								зона предзагрузки элементов
							</span>
							<span
								className='absolute text-center tracking-widest text-gray-600 uppercase pointer-events-none'
								style={{
									left: 0,
									top: state.canvasH + 175,
									width: state.canvasW,
									fontSize: 28,
								}}
							>
								зона предзагрузки элементов
							</span>
							<span
								className='absolute tracking-widest text-gray-600 uppercase pointer-events-none'
								style={{
									left: -175,
									top: 0,
									height: state.canvasH,
									writingMode: 'vertical-rl',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: 28,
								}}
							>
								зона предзагрузки элементов
							</span>
							<span
								className='absolute tracking-widest text-gray-600 uppercase pointer-events-none'
								style={{
									left: state.canvasW + 175,
									top: 0,
									height: state.canvasH,
									writingMode: 'vertical-rl',
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									fontSize: 28,
								}}
							>
								зона предзагрузки элементов
							</span>
							{/* Как в Pogly: при мультивыделении тянется не только элемент или
							    грань, но и пустое место внутри общей рамки. Слой лежит ПОД
							    элементами (zIndex 0), поэтому сами элементы остаются
							    интерактивными, а клик по пустоте двигает всю группу. */}
							{groupBox && selectedIds.size > 1 && (
								<div
									className='absolute'
									data-nopan='1'
									title='Перетащить выбранные элементы'
									style={{
										left: groupBox.cx,
										top: groupBox.cy,
										width: groupBox.w,
										height: groupBox.h,
										transform: `translate(-50%, -50%) rotate(${groupBox.rot}deg)`,
										transformOrigin: 'center',
										cursor: 'move',
										touchAction: 'none',
										zIndex: 0,
									}}
									onPointerDown={startGroupMove}
								/>
							)}
							{state.elements.map(el => {
								const hs = 10 / view.s
								// у медиа (YouTube/Twitch/видео) плашка управления показывается
								// наведением — значит, обёртка должна отдавать enter/leave
								const isMedia =
									el.type === 'video' ||
									(el.type === 'iframe' && !!parseMediaUrl(el.src || ''))
								// при мультивыделении ручки отдельных элементов не показываем:
								// ими управляет общий бокс группы, иначе над ним появляется
								// вторая «крутилка» и перехватывает мышь
								const multiSelect = selectedIds.size > 1
								return (
									<div
										key={el.id}
										onPointerDown={e => handleDragStart(e, el)}
										data-elwrap='1'
										className={`absolute select-none group ${el.locked ? '' : 'cursor-grab'}`}
										style={{
											left: el.x,
											top: el.y,
											width: el.width,
											height: el.height,
											// слой элемента подчиняется своему zIndex и в выделении:
											// иначе кнопки «Вперёд/Назад» визуально ничего не меняют,
											// пока элемент выбран. Ручки вынесены в отдельный слой выше.
											zIndex: el.zIndex,
											opacity: el.visible
												? Math.max(el.opacity ?? 1, 0.08)
												: 0.35,
											outline: selectedIds.has(el.id)
												? `${1.5 / view.s}px solid rgb(var(--c-accent2) / .6)`
												: undefined,
											transform:
												`${el.rotation ? `rotate(${el.rotation}deg)` : ''}${el.flipH || el.flipV ? ` scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : ''}` ||
												undefined,
											touchAction: 'none',
										}}
										onPointerEnter={
											isMedia
												? () => chromeCtlRefs.current.get(el.id)?.enter()
												: undefined
										}
										onPointerMove={
											isMedia
												? () => chromeCtlRefs.current.get(el.id)?.note()
												: undefined
										}
										onPointerLeave={
											isMedia
												? () => chromeCtlRefs.current.get(el.id)?.leave()
												: undefined
										}
									>
										{el.type !== 'text' &&
											el.type !== 'timer' &&
											el.type !== 'widget' &&
											el.bgColor &&
											el.bgColor !== 'transparent' && (
												<div
													className='absolute inset-0 pointer-events-none'
													style={{
														background: colorWithOpacity(
															el.bgColor,
															el.bgOpacity ?? 1,
														),
														borderRadius: el.radius ? el.radius : undefined,
													}}
												/>
											)}
										<PreviewElement
											el={el}
											scale={1}
											interactive={interactiveIframeId === el.id}
											mounted={mounted}
											mediaSt={mediaStates.get(el.id)}
											chromeRegister={registerChromeCtl}
											mediaToggle={mediaToggle}
											mediaSelect={selectOnly}
											mediaCommand={mediaCommand}
											onMediaState={applyMediaState}
											onTwitchPlayer={onTwitchPlayer}
											channel={channel}
										/>
										{(() => {
											// невидимка лок не показывает: он всё равно может забрать
											// элемент, а ник владельца лока ему не нужен
											const l = elementLocks[el.id]
											return !ghost &&
												l &&
												l.until > Date.now() &&
												l.by !== (userLogin ?? '') ? (
												<div
													className='absolute pointer-events-none select-none'
													style={{
														left: 0,
														top: -24 / view.s,
														transform: `scale(${1 / view.s})`,
														transformOrigin: '0 0',
													}}
												>
													<span
														className='inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-white'
														style={{
															background: 'rgb(var(--c-accent))',
															boxShadow: '0 1px 4px rgba(0,0,0,.4)',
														}}
													>
														✋ {l.by || 'занято'}
													</span>
												</div>
											) : null
										})()}
										{/* слой ручек: контр-зеркалится, чтобы при flipH/flipV ручки не переворачивались вместе с элементом */}
										<div
											className='absolute inset-0 pointer-events-none'
											style={{
												transform: `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})`,
												// у выбранного элемента ручки рисует отдельный слой
												// поверх всех элементов — здесь остаётся только hover
												display: selectedId === el.id ? 'none' : undefined,
											}}
										>
											{selectedId === el.id &&
												!el.locked &&
												(
													['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
												).map(dir => {
													const cursors: Record<string, string> = {
														n: 'ns-resize',
														s: 'ns-resize',
														e: 'ew-resize',
														w: 'ew-resize',
														ne: 'nesw-resize',
														sw: 'nesw-resize',
														nw: 'nwse-resize',
														se: 'nwse-resize',
													}
													const pos: React.CSSProperties = {
														position: 'absolute',
														width: hs,
														height: hs,
														pointerEvents: 'auto',
														background: 'rgb(var(--c-accent2))',
														border: `${2 / view.s}px solid #fff`,
														borderRadius: 2,
														cursor: cursors[dir],
													}
													if (dir.includes('n')) pos.top = -hs / 2
													if (dir.includes('s')) pos.bottom = -hs / 2
													if (dir.includes('e')) pos.right = -hs / 2
													if (dir.includes('w')) pos.left = -hs / 2
													if (dir === 'n' || dir === 's') {
														pos.left = '50%'
														pos.marginLeft = -hs / 2
													}
													if (dir === 'e' || dir === 'w') {
														pos.top = '50%'
														pos.marginTop = -hs / 2
													}
													return (
														<div
															key={dir}
															onPointerDown={e => handleResizeStart(e, el, dir)}
															className='handle'
															style={pos}
														/>
													)
												})}
											{el.type === 'iframe' &&
												selectedId === el.id &&
												!el.locked && (
													<div
														onPointerDown={e => {
															e.stopPropagation()
															handleDragStart(e, el)
														}}
														className='absolute flex items-center justify-center rounded-full pointer-events-auto'
														style={{
															left: `calc(50% - ${11 / view.s}px)`,
															top: -60 / view.s,
															width: 22 / view.s,
															height: 22 / view.s,
															background: 'rgb(var(--c-accent2))',
															border: `${2 / view.s}px solid #fff`,
															cursor: 'move',
															boxShadow: '0 1px 6px rgba(0,0,0,.5)',
														}}
													>
														<svg
															width={(22 / view.s) * 0.55}
															height={(22 / view.s) * 0.55}
															viewBox='0 0 24 24'
															fill='#fff'
														>
															<path d='M12 1.5 15.5 5h-2.5v4.5h-2V5H8.5L12 1.5z' />
															<path d='M12 22.5 8.5 19H11v-4.5h2V19h2.5L12 22.5z' />
															<path d='M1.5 12 5 8.5V11h4.5v2H5v2.5L1.5 12z' />
															<path d='M22.5 12 19 15.5V13h-4.5v-2H19V8.5L22.5 12z' />
														</svg>
													</div>
												)}
											{!el.locked && !multiSelect && (
												<div
													onPointerDown={e => handleRotateStart(e, el)}
													title='Повернуть (Shift — шаг 15°)'
													className={`absolute rounded-full flex items-center justify-center transition-opacity ${selectedId === el.id ? 'pointer-events-auto' : 'pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100'}`}
													style={{
														left: `calc(50% - ${11 / view.s}px)`,
														top: -32 / view.s,
														width: 22 / view.s,
														height: 22 / view.s,
														background: 'rgb(var(--c-accent))',
														border: `${2 / view.s}px solid #fff`,
														cursor: 'grab',
														boxShadow: '0 1px 6px rgba(0,0,0,.5)',
													}}
												>
													<svg
														width={12 / view.s}
														height={12 / view.s}
														viewBox='0 0 24 24'
														fill='none'
														stroke='#fff'
														strokeWidth='2.5'
														strokeLinecap='round'
														style={{
															transform: `rotate(${-(el.rotation ?? 0)}deg)`,
														}}
													>
														<path d='M21 12a9 9 0 1 1-2.64-6.36' />
														<path d='M21 3v6h-6' />
													</svg>
												</div>
											)}
										</div>
									</div>
								)
							})}
							{/* Ручки выбранного элемента — отдельным слоем поверх всех элементов:
							    сам элемент остаётся на своём слое, поэтому «Вперёд/Назад»
							    видно сразу, а ручки не прячутся под картинками выше */}
							{selected && selectedIds.size === 0 && !selected.locked && (
								<div
									className='absolute'
									style={{
										left: selected.x,
										top: selected.y,
										width: selected.width,
										height: selected.height,
										transform:
											`${selected.rotation ? `rotate(${selected.rotation}deg)` : ''}${
												selected.flipH || selected.flipV
													? ` scale(${selected.flipH ? -1 : 1}, ${selected.flipV ? -1 : 1})`
													: ''
											}` || undefined,
										transformOrigin: 'center',
										pointerEvents: 'none',
										zIndex: 2000,
									}}
								>
									<div
										className='absolute inset-0 pointer-events-none'
										style={{
											outline: `${2 / view.s}px solid rgb(var(--c-accent2))`,
										}}
									/>
									<div
										className='absolute inset-0 pointer-events-none'
										style={{
											transform: `scale(${selected.flipH ? -1 : 1}, ${selected.flipV ? -1 : 1})`,
										}}
									>
										{(
											['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
										).map(dir => {
											const cursors: Record<string, string> = {
												n: 'ns-resize',
												s: 'ns-resize',
												e: 'ew-resize',
												w: 'ew-resize',
												ne: 'nesw-resize',
												sw: 'nesw-resize',
												nw: 'nwse-resize',
												se: 'nwse-resize',
											}
											const hs = 10 / view.s
											const pos: React.CSSProperties = {
												position: 'absolute',
												width: hs,
												height: hs,
												pointerEvents: 'auto',
												background: 'rgb(var(--c-accent2))',
												border: `${2 / view.s}px solid #fff`,
												borderRadius: 2,
												cursor: cursors[dir],
												touchAction: 'none',
											}
											if (dir.includes('n')) pos.top = -hs / 2
											if (dir.includes('s')) pos.bottom = -hs / 2
											if (dir.includes('e')) pos.right = -hs / 2
											if (dir.includes('w')) pos.left = -hs / 2
											if (dir === 'n' || dir === 's') {
												pos.left = '50%'
												pos.marginLeft = -hs / 2
											}
											if (dir === 'e' || dir === 'w') {
												pos.top = '50%'
												pos.marginTop = -hs / 2
											}
											return (
												<div
													key={'sel-' + dir}
													onPointerDown={e =>
														handleResizeStart(e, selected, dir)
													}
													data-nopan='1'
													className='handle'
													style={pos}
												/>
											)
										})}
										{selected.type === 'iframe' && (
											<div
												onPointerDown={e => {
													e.stopPropagation()
													handleDragStart(e, selected)
												}}
												data-nopan='1'
												className='absolute flex items-center justify-center rounded-full pointer-events-auto'
												style={{
													left: `calc(50% - ${11 / view.s}px)`,
													top: -60 / view.s,
													width: 22 / view.s,
													height: 22 / view.s,
													background: 'rgb(var(--c-accent2))',
													border: `${2 / view.s}px solid #fff`,
													cursor: 'move',
													boxShadow: '0 1px 6px rgba(0,0,0,.5)',
													touchAction: 'none',
												}}
											>
												<svg
													width={(22 / view.s) * 0.55}
													height={(22 / view.s) * 0.55}
													viewBox='0 0 24 24'
													fill='#fff'
												>
													<path d='M12 1.5 15.5 5h-2.5v4.5h-2V5H8.5L12 1.5z' />
													<path d='M12 22.5 8.5 19H11v-4.5h2V19h2.5L12 22.5z' />
													<path d='M1.5 12 5 8.5V11h4.5v2H5v2.5L1.5 12z' />
													<path d='M22.5 12 19 15.5V13h-4.5v-2H19V8.5L22.5 12z' />
												</svg>
											</div>
										)}
										<div
											onPointerDown={e => handleRotateStart(e, selected)}
											title='Повернуть (Shift — шаг 15°)'
											data-nopan='1'
											className='absolute rounded-full flex items-center justify-center pointer-events-auto'
											style={{
												left: `calc(50% - ${11 / view.s}px)`,
												top: -32 / view.s,
												width: 22 / view.s,
												height: 22 / view.s,
												background: 'rgb(var(--c-accent))',
												border: `${2 / view.s}px solid #fff`,
												cursor: 'grab',
												boxShadow: '0 1px 6px rgba(0,0,0,.5)',
												touchAction: 'none',
											}}
										>
											<svg
												width={12 / view.s}
												height={12 / view.s}
												viewBox='0 0 24 24'
												fill='none'
												stroke='#fff'
												strokeWidth='2.5'
												strokeLinecap='round'
												style={{
													transform: `rotate(${-(selected.rotation ?? 0)}deg)`,
												}}
											>
												<path d='M21 12a9 9 0 1 1-2.64-6.36' />
												<path d='M21 3v6h-6' />
											</svg>
										</div>
									</div>
								</div>
							)}
							{/* групповой бокс выделения (как в pogly): бокс повёрнут вместе с контентом,
							    ручки прикреплены к нему; тянешь грани — двигается группа,
							    угловые ручки — масштабируют, верхняя — вращает всю группу */}
							{groupBox && selectedIds.size > 1 && (
								<div
									className='absolute'
									style={{
										left: groupBox.cx,
										top: groupBox.cy,
										width: groupBox.w,
										height: groupBox.h,
										transform: `translate(-50%, -50%) rotate(${groupBox.rot}deg)`,
										transformOrigin: 'center',
										// Корень бокса не должен перехватывать клики: иначе элементы
										// внутри рамки нельзя ни выделить, ни тащить (работает только
										// тот, что оказался выше по z-index). Интерактивны только ручки.
										pointerEvents: 'none',
										// Выше элементов (у них zIndex 0..N), но ниже курсоров других
										// участников (3000): ручки не прячутся под картинками и при 3+ элементах
										zIndex: 2000,
									}}
								>
									<div
										className='absolute inset-0 border border-dashed pointer-events-none'
										style={{ borderColor: 'rgb(var(--c-accent2))' }}
									/>
									{(
										[
											['n', groupBox.w / 2 - 30, -7, 60, 14],
											['s', groupBox.w / 2 - 30, groupBox.h - 7, 60, 14],
											['w', -7, groupBox.h / 2 - 30, 14, 60],
											['e', groupBox.w - 7, groupBox.h / 2 - 30, 14, 60],
										] as const
									).map(([k, left, top, w, h]) => (
										<div
											key={'edge-' + k}
											className='absolute pointer-events-auto'
											data-nopan='1'
											style={{
												left,
												top,
												width: w,
												height: h,
												cursor: 'move',
												touchAction: 'none',
											}}
											onPointerDown={startGroupMove}
										/>
									))}
									{(
										[
											['nw', 0, 0, 'nwse-resize'],
											['ne', groupBox.w, 0, 'nesw-resize'],
											['sw', 0, groupBox.h, 'nesw-resize'],
											['se', groupBox.w, groupBox.h, 'nwse-resize'],
										] as const
									).map(([corner, left, top, cursor]) => (
										<div
											key={corner}
											className='absolute pointer-events-auto'
											data-nopan='1'
											style={{
												left: left - 7 / view.s,
												top: top - 7 / view.s,
												width: 14 / view.s,
												height: 14 / view.s,
												background: 'rgb(var(--c-accent2))',
												border: `${2 / view.s}px solid #fff`,
												borderRadius: 2,
												cursor,
												touchAction: 'none',
											}}
											onPointerDown={e => startGroupScale(e, corner)}
										/>
									))}
									<div
										className='absolute rounded-full flex items-center justify-center pointer-events-auto'
										data-nopan='1'
										style={{
											left: groupBox.w / 2 - 11 / view.s,
											top: -44 / view.s,
											width: 22 / view.s,
											height: 22 / view.s,
											background: 'rgb(var(--c-accent))',
											border: `${2 / view.s}px solid #fff`,
											cursor: 'grab',
											boxShadow: '0 1px 6px rgba(0,0,0,.5)',
										}}
										onPointerDown={startGroupRotate}
										title='Повернуть группу (Shift — шаг 15°)'
									>
										<svg
											width={12 / view.s}
											height={12 / view.s}
											viewBox='0 0 24 24'
											fill='none'
											stroke='#fff'
											strokeWidth='2.5'
											strokeLinecap='round'
											style={{
												// иконка всегда «прямая», хотя бокс повёрнут
												transform: `rotate(${-groupBox.rot}deg)`,
											}}
										>
											<path d='M21 12a9 9 0 1 1-2.64-6.36' />
											<path d='M21 3v6h-6' />
										</svg>
									</div>
								</div>
							)}
							{/* курсоры других участников: контр-скейл, чтобы курсор был одного размера на любом зуме */}
							{remoteCursors
								.filter(c => !c.hidden)
								.map(c => (
									<div
										key={c.id}
										className='absolute pointer-events-none select-none'
										style={{
											left: c.x,
											top: c.y,
											zIndex: 3000,
											transform: `scale(${1 / view.s})`,
											transformOrigin: '0 0',
											transition: 'left 70ms linear, top 70ms linear',
										}}
									>
										<svg
											width='16'
											height='21'
											viewBox='0 0 24 28'
											style={{
												filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.55))',
											}}
										>
											<path
												d='M4 2l14.5 10.6-6.8.7L14.6 21l-3.4 1.4-2.9-7.7L4 18.4z'
												fill='rgb(var(--c-accent2))'
												stroke='#fff'
												strokeWidth='1.6'
												strokeLinejoin='round'
											/>
										</svg>
										<div
											className='ml-2 mt-0.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-white'
											style={{
												background: 'rgb(var(--c-accent))',
												boxShadow: '0 1px 4px rgba(0,0,0,.4)',
											}}
										>
											{c.login}
										</div>
									</div>
								))}
						</div>
						{/* минималистичное меню: окно элементов свёрнуто по умолчанию */}
						{betaUI && (
							<div
								className='absolute left-3 top-3 z-20 w-72 max-w-[calc(100%-1.5rem)]'
								data-nopan='1'
								onPointerDown={e => e.stopPropagation()}
							>
								<div className='rounded-2xl border border-border bg-panel/95 backdrop-blur shadow-xl overflow-hidden'>
									<button
										onClick={() => setBetaElementsOpen(v => !v)}
										aria-expanded={betaElementsOpen}
										className='w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-border/40 transition-colors'
									>
										<Layers size={15} className='text-accent2 shrink-0' />
										<span className='text-sm font-medium text-[color:var(--c-on-bg)]'>
											Элементы
										</span>
										<span className='text-xs text-gray-500'>
											({state.elements.length})
										</span>
										<span className='flex-1' />
										{betaElementsOpen ? (
											<ChevronUp size={16} className='text-gray-400' />
										) : (
											<ChevronDown size={16} className='text-gray-400' />
										)}
									</button>
									{betaElementsOpen && (
										<div className='border-t border-border'>
											{state.elements.length > 0 && (
												<div className='flex justify-end px-2 pt-2'>
													<button
														onClick={() => {
															if (confirm('Очистить все элементы?')) {
																remember()
																emit('elements:clear')
															}
														}}
														className='inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-red-900/50 text-red-400 hover:bg-red-950/40 transition-colors'
													>
														<Trash2 size={11} />
														Очистить
													</button>
												</div>
											)}
											<div className='grid grid-cols-2 gap-2 p-2 max-h-[45vh] overflow-y-auto'>
												{state.elements.map(el => (
													<ElementCard
														key={el.id}
														el={el}
														selected={selectedId === el.id}
														active={selectedIds.has(el.id)}
														onSelect={() => selectOnly(el.id)}
														onToggleVisible={() => {
															setState(p => ({
																...p,
																elements: p.elements.map(x =>
																	x.id === el.id
																		? { ...x, visible: !x.visible }
																		: x,
																),
															}))
															emit('element:toggle-visible', el.id)
														}}
														onDelete={() => {
															remember()
															emit('element:delete', el.id)
															if (selectedId === el.id) setSelectedId(null)
														}}
													/>
												))}
											</div>
											{state.elements.length === 0 && (
												<p className='px-3 pb-3 text-xs text-gray-600'>
													Нет элементов. Добавьте снизу.
												</p>
											)}
										</div>
									)}
								</div>
							</div>
						)}
						{/* минималистичное меню: нижнее меню добавления элементов */}
						{betaUI && !isMobile && (
							<div
								className='absolute bottom-4 left-1/2 -translate-x-1/2 z-20'
								data-nopan='1'
								onPointerDown={e => e.stopPropagation()}
							>
								<div className='flex items-center gap-0.5 rounded-2xl border border-border bg-panel/95 px-2 py-1.5 shadow-2xl backdrop-blur'>
									<DockButton
										label='Добавить картинку'
										onClick={() => setAddSheet('image')}
									>
										<ImagePlus size={17} />
									</DockButton>
									<DockButton
										label='Добавить видео'
										onClick={() => setAddSheet('video')}
									>
										<Film size={17} />
									</DockButton>
									<DockButton
										label='Добавить звук'
										onClick={() => setAddSheet('audio')}
									>
										<Volume2 size={17} />
									</DockButton>
									<div className='w-px h-6 bg-border mx-1' />
									<DockButton label='Смайлик' onClick={() => openEmotePicker()}>
										<Smile size={17} />
									</DockButton>
									<DockButton label='Сайт' onClick={addIframeEl}>
										<Globe size={17} />
									</DockButton>
									<DockButton
										label='Виджеты'
										onClick={() => setWidgetPickerOpen(true)}
									>
										<Blocks size={17} />
									</DockButton>
									<DockButton
										label='YouTube плейлист'
										onClick={() => {
											setPlaylistOpen(true)
											setPlaylistError('')
										}}
									>
										<ListVideo size={17} />
									</DockButton>
									<DockButton label='Текст' onClick={addTextEl}>
										<Type size={17} />
									</DockButton>
									<DockButton label='Таймер' onClick={addTimerEl}>
										<Timer size={17} />
									</DockButton>
									<div className='w-px h-6 bg-border mx-1' />
									<button
										onClick={() => setBetaElementsOpen(v => !v)}
										title='Список элементов'
										aria-label='Список элементов'
										className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
											betaElementsOpen
												? 'bg-accent text-white'
												: 'text-gray-300 hover:bg-border hover:text-white'
										}`}
									>
										<Layers size={17} />
										{state.elements.length > 0 && (
											<span className='absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-accent text-white text-[9px] leading-[15px] text-center'>
												{state.elements.length}
											</span>
										)}
									</button>
								</div>
							</div>
						)}
						{!isMobile && !betaUI && !sidebarOpen && (
							<button
								onClick={toggleSidebar}
								title='Показать панель элементов'
								data-nopan='1'
								onPointerDown={e => e.stopPropagation()}
								className='absolute left-0 top-1/2 -translate-y-1/2 z-20 rounded-r-lg border border-l-0 border-border bg-panel px-1.5 py-3 text-gray-400 hover:text-white hover:bg-border transition-colors'
							>
								›
							</button>
						)}
						{previewPill}
						{!isMobile && chatPill}
						{marquee && (
							<div
								className='absolute z-30 pointer-events-none border border-accent2 bg-accent2/20'
								style={{
									left: Math.min(marquee.x1, marquee.x2),
									top: Math.min(marquee.y1, marquee.y2),
									width: Math.abs(marquee.x2 - marquee.x1),
									height: Math.abs(marquee.y2 - marquee.y1),
								}}
							/>
						)}
						{dropHover && (
							<div className='absolute inset-0 z-30 pointer-events-none flex items-center justify-center bg-black/40 border-2 border-dashed border-accent rounded-lg'>
								<span className='text-sm text-gray-200 bg-panel/95 border border-border px-4 py-2 rounded-lg'>
									Отпустите файл — картинка, гифка или видео добавятся на канвас
								</span>
							</div>
						)}
						{isMobile ? (
							// мобильный: левый нижний угол — «− +» в ряд (шириной с «Сбросить»), «Сбросить» под ними
							<div
								className='absolute left-4 bottom-20 z-10 flex flex-col items-stretch gap-1.5'
								data-nopan='1'
								onPointerDown={e => e.stopPropagation()}
							>
								<div className='flex items-stretch gap-1.5'>
									<button
										onClick={() => zoomBy(1 / 1.25)}
										title='Уменьшить'
										className='flex-1 h-6 rounded-md bg-panel border border-border text-gray-400 hover:text-white flex items-center justify-center text-xs'
									>
										−
									</button>
									<button
										onClick={() => zoomBy(1.25)}
										title='Увеличить'
										className='flex-1 h-6 rounded-md bg-panel border border-border text-gray-400 hover:text-white flex items-center justify-center text-xs'
									>
										+
									</button>
								</div>
								<button
									onClick={() => {
										if (baseViewRef.current) setView(baseViewRef.current)
									}}
									className='h-6 rounded-md bg-panel border border-border px-2 text-[11px] text-gray-400 hover:text-white transition-colors'
								>
									Сбросить
								</button>
							</div>
						) : (
							// ПК: левый нижний угол — процент зума + / − / Сбросить в один ряд, под ними предупреждение об автоочистке
							<div
								className='absolute left-4 bottom-3 z-10 flex flex-col items-start gap-1'
								data-nopan='1'
								onPointerDown={e => e.stopPropagation()}
							>
								<div className='flex items-center gap-1.5'>
									<span className='flex items-center gap-1.5 bg-panel border border-border rounded-md px-2 py-1 text-[11px] font-medium text-accent2'>
										<svg
											width='11'
											height='11'
											viewBox='0 0 24 24'
											fill='none'
											stroke='currentColor'
											strokeWidth='2.5'
											strokeLinecap='round'
											aria-hidden='true'
										>
											<circle cx='11' cy='11' r='7' />
											<line x1='21' y1='21' x2='16.2' y2='16.2' />
										</svg>
										{Math.round(
											(view.s / (baseViewRef.current?.s ?? view.s)) * 100,
										)}
										%
									</span>
									<button
										onClick={() => zoomBy(1.25)}
										title='Увеличить'
										className='w-6 h-6 rounded-md bg-panel border border-border text-gray-400 hover:text-white flex items-center justify-center text-xs'
									>
										+
									</button>
									<button
										onClick={() => zoomBy(1 / 1.25)}
										title='Уменьшить'
										className='w-6 h-6 rounded-md bg-panel border border-border text-gray-400 hover:text-white flex items-center justify-center text-xs'
									>
										−
									</button>
									<button
										onClick={() => {
											if (baseViewRef.current) setView(baseViewRef.current)
										}}
										className='rounded-md bg-panel border border-border px-2 py-1 text-[11px] text-gray-400 hover:text-white transition-colors'
									>
										Сбросить
									</button>
								</div>
							</div>
						)}
					</div>
				</div>

				{selected && (
					<aside
						className={`w-72 shrink-0 bg-panel border-l border-border p-4 overflow-y-auto ${isMobile ? 'hidden' : ''}`}
					>
						{/* Удаление всегда под рукой: у длинного списка карточка с крестиком
							    может уйти за пределы видимой области, а у ghost-элемента её
							    легко не найти */}
						<div className='flex items-center justify-between mb-2'>
							<span className='text-[10px] uppercase tracking-wide text-gray-600'>
								Элемент
							</span>
							<button
								onClick={() => {
									remember()
									emit('element:delete', selected.id)
									setSelectedId(null)
									setSelectedIds(prev => {
										const n = new Set(prev)
										n.delete(selected.id)
										return n
									})
								}}
								title='Удалить элемент'
								className='px-1.5 py-0.5 text-xs text-red-400 border border-red-900/50 rounded-md hover:bg-red-950/40 transition-colors'
							>
								✕
							</button>
						</div>
						<PropertyEditor
							el={selected}
							update={partial => updateElement(selected.id, partial)}
							emit={emit}
							onEditWidget={editWidgetFromElement}
						/>
					</aside>
				)}
			</div>

			<div
				className={`flex-1 min-h-0 ${tab === 'widgets' ? 'flex flex-col' : 'hidden'}`}
			>
				{widgetStudioMounted && (
					<WidgetStudio
						widgets={state.widgets || {}}
						channel={channel}
						ownerLogin={userLogin}
						theme={theme}
						onSave={saveWidget}
						onDelete={deleteWidget}
						editWidget={pendingWidgetEdit}
						onEditWidgetDone={() => setPendingWidgetEdit(null)}
					/>
				)}
			</div>

			<div className={`flex-1 overflow-auto ${tab === 'obs' ? '' : 'hidden'}`}>
				{obsMounted && <ObsPanel />}
			</div>

			{/* чат канала во вкладке: iframe живёт только пока вкладка открыта,
			    чтобы не держать второй чат вместе с плавающим окном */}
			{tab === 'chat' && (
				<div className='flex-1 min-h-0 flex'>
					{channel ? (
						<iframe
							src={`https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(parentHost)}&darkpopout`}
							title={`Чат канала ${channel}`}
							className='w-full h-full border-0'
						/>
					) : (
						<div className='m-auto max-w-sm px-6 text-center'>
							<MessageCircle size={30} className='mx-auto mb-3 text-gray-600' />
							<p className='text-sm text-gray-500'>
								Чат доступен после входа через Twitch: панель должна знать канал
								стримера.
							</p>
						</div>
					)}
				</div>
			)}

			<div
				className={`flex-1 overflow-auto ${tab === 'settings' ? '' : 'hidden'}`}
			>
				<div className='max-w-2xl mx-auto p-5 sm:p-8'>
					<h2 className='text-lg font-semibold text-[color:var(--c-on-bg)]'>
						Настройки
					</h2>
					<p className='mt-1 text-sm text-gray-500'>
						Внешний вид панели сохраняется в этом браузере.
					</p>
					<div className='mt-5 rounded-2xl border border-border bg-panel p-4 sm:p-5'>
						<div className='flex items-start gap-3 sm:gap-4'>
							<span className='w-10 h-10 shrink-0 rounded-xl bg-accent/15 text-accent2 flex items-center justify-center'>
								<Settings size={19} />
							</span>
							<div className='min-w-0 flex-1'>
								<div className='flex flex-wrap items-center gap-2'>
									<h3 className='text-sm font-semibold text-[color:var(--c-on-bg)]'>
										Минималистичное меню
									</h3>
								</div>
								<p className='mt-1 text-sm leading-relaxed text-gray-500'>
									Компактное меню добавления элементов внизу и сворачиваемый
									список элементов. Выключено — привычная панель с боковым меню.
								</p>
							</div>
							<button
								role='switch'
								aria-checked={betaUI}
								aria-label='Минималистичное меню'
								onClick={toggleBetaUI}
								className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
									betaUI ? 'bg-accent' : 'bg-gray-600'
								}`}
							>
								<span
									className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
										betaUI ? 'left-[22px]' : 'left-0.5'
									}`}
								/>
							</button>
						</div>
						<p className='mt-3 border-t border-border pt-3 text-xs leading-relaxed text-gray-500'>
							{betaUI
								? 'Включено: элементы добавляются с нижней панели, список — в левом верхнем углу и свёрнут.'
								: 'Выключено: используется панель с боковым меню.'}
						</p>
					</div>
					<div className='mt-4 rounded-2xl border border-border bg-panel p-4 sm:p-5'>
						<div className='flex items-start gap-3 sm:gap-4'>
							<span className='w-10 h-10 shrink-0 rounded-xl bg-accent/15 text-accent2 flex items-center justify-center'>
								<Monitor size={19} />
							</span>
							<div className='min-w-0 flex-1'>
								<h3 className='text-sm font-semibold text-[color:var(--c-on-bg)]'>
									Управление OBS
								</h3>
								<p className='mt-1 text-sm leading-relaxed text-gray-500'>
									Показывать вкладку «Управление OBS» в панели. По умолчанию она
									скрыта и не мешает работе.
								</p>
							</div>
							<button
								role='switch'
								aria-checked={showObsTab}
								aria-label='Показывать вкладку Управление OBS'
								onClick={toggleObsTab}
								className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${
									showObsTab ? 'bg-accent' : 'bg-gray-600'
								}`}
							>
								<span
									className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
										showObsTab ? 'left-[22px]' : 'left-0.5'
									}`}
								/>
							</button>
						</div>
						<p className='mt-3 border-t border-border pt-3 text-xs leading-relaxed text-gray-500'>
							{showObsTab
								? 'Включено: вкладка OBS показывается после «Виджет».'
								: 'Выключено: вкладка OBS скрыта.'}
						</p>
					</div>
				</div>
			</div>
			{isMobile && menuOpen && (
				<>
					<div
						className={`fixed inset-0 z-40 ${menuClosing ? 'fade-out' : 'fade-in'}`}
						onClick={closeBurger}
					/>
					<div
						className={`fixed top-[60px] left-2 z-50 w-64 bg-panel border border-border rounded-xl p-2 shadow-xl space-y-1 ${menuClosing ? 'pop-out' : 'pop-in'}`}
						style={{ transformOrigin: 'top left' }}
					>
						<button
							onClick={() => {
								setTab('elements')
								closeBurger()
							}}
							className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${tab === 'elements' ? 'bg-accent text-white' : 'text-gray-300 hover:bg-border'}`}
						>
							Элементы оверлея
						</button>
						<button
							onClick={() => {
								setTab('widgets')
								closeBurger()
							}}
							className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg transition-colors ${tab === 'widgets' ? 'bg-accent text-white' : 'text-gray-300 hover:bg-border'}`}
						>
							<Blocks size={15} />
							Виджеты
						</button>
						{showObsTab && (
							<button
								onClick={() => {
									setTab('obs')
									closeBurger()
								}}
								className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${tab === 'obs' ? 'bg-accent text-white' : 'text-gray-300 hover:bg-border'}`}
							>
								Управление OBS
							</button>
						)}
						<button
							onClick={() => {
								setTab('chat')
								closeBurger()
							}}
							className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg transition-colors ${tab === 'chat' ? 'bg-accent text-white' : 'text-gray-300 hover:bg-border'}`}
						>
							<MessageCircle size={15} />
							Чат
						</button>
						<button
							onClick={() => {
								setTab('settings')
								closeBurger()
							}}
							className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm rounded-lg transition-colors ${tab === 'settings' ? 'bg-accent text-white' : 'text-gray-300 hover:bg-border'}`}
						>
							<Settings size={15} />
							Настройки
						</button>
						<div className='h-px bg-border my-1' />
						<div className='flex items-center justify-between px-3 py-1.5'>
							<span className='text-sm text-gray-300'>
								Тема: {theme === 'dark' ? 'тёмная' : 'светлая'}
							</span>
							<button
								onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
								className={`w-9 h-9 rounded-full bg-border flex items-center justify-center transition-colors ${theme === 'dark' ? 'text-gray-300' : 'text-[#443f66]'}`}
							>
								{theme === 'dark' ? <SunIcon /> : <MoonIcon />}
							</button>
						</div>
						<div className='flex items-center gap-2 px-3 py-1.5'>
							<span
								className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
							/>
							<span
								className={`text-sm ${connected ? 'text-green-400' : 'text-red-400'}`}
							>
								Сервер: {connected ? 'онлайн' : 'оффлайн'}
							</span>
						</div>
						<a
							href='https://dalink.to/jettle_'
							target='_blank'
							rel='noopener noreferrer'
							className='block px-3 py-1.5 text-sm text-accent2 hover:bg-border rounded-lg'
						>
							Поддержать проект ❤️
						</a>
					</div>
				</>
			)}

			{/* мобильный тулбар: добавление элементов одним касанием.
			    на вкладке чата его нет — иначе он перекрывает поле ввода Twitch
			    и защита Twitch блокирует чат владельцу/модераторам */}
			{isMobile && tab !== 'chat' && (
				<div
					className='fixed inset-x-0 bottom-0 z-40 flex items-center justify-center px-2 pointer-events-none'
					style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
				>
					<div className='flex items-center gap-0.5 pointer-events-auto rounded-full border border-border bg-panel px-2 py-1 max-[380px]:gap-0 max-[380px]:px-1'>
						<button
							title='Картинка'
							aria-label='Картинка'
							onClick={() => setAddSheet('image')}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<ImagePlus size={16} />
						</button>
						<button
							title='Смайлик'
							aria-label='Смайлик'
							onClick={() => openEmotePicker()}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Smile size={16} />
						</button>
						<button
							title='Видео'
							aria-label='Видео'
							onClick={() => setAddSheet('video')}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Film size={16} />
						</button>
						<button
							title='Звук'
							aria-label='Звук'
							onClick={() => setAddSheet('audio')}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Volume2 size={16} />
						</button>
						<button
							title='Сайт'
							aria-label='Сайт'
							onClick={addIframeEl}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Globe size={16} />
						</button>
						<button
							title='Добавить виджет'
							aria-label='Добавить виджет'
							onClick={() => setWidgetPickerOpen(true)}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Blocks size={16} />
						</button>
						<button
							title='YouTube плейлист'
							aria-label='YouTube плейлист'
							onClick={() => {
								setPlaylistOpen(true)
								setPlaylistError('')
							}}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<ListVideo size={16} />
						</button>
						<button
							title='Текст'
							aria-label='Текст'
							onClick={addTextEl}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Type size={16} />
						</button>
						<button
							title='Таймер'
							aria-label='Таймер'
							onClick={addTimerEl}
							className='w-8 h-8 rounded-lg hover:bg-border active:bg-accent flex items-center justify-center'
						>
							<Timer size={16} />
						</button>
						<button
							title={
								selected ? 'Свойства элемента' : 'Выберите элемент на холсте'
							}
							aria-label='Свойства элемента'
							onClick={() => setSheetOpen(v => !v)}
							className={`w-8 h-8 rounded-lg flex items-center justify-center ${sheetOpen && selected ? 'bg-accent text-white' : 'hover:bg-border'}`}
						>
							<SlidersHorizontal size={16} />
						</button>
					</div>
				</div>
			)}

			{/* чат плавающим окном: портал в body, без клиппинга, opacity и
			    transform-родителей. Twitch отключает ввод владельцу/модераторам,
			    если его iframe хоть чем-то перекрыт или обрезан. */}
			{mounted &&
				!isMobile &&
				chatOn &&
				channel &&
				tab === 'elements' &&
				typeof document !== 'undefined' &&
				createPortal(
					<div
						className='flex flex-col rounded-2xl overflow-hidden border border-border bg-panel shadow-2xl'
						style={{
							position: 'fixed',
							top: chatTop,
							right: chatRight,
							// минимум для ширины не нужен после понижения плашек:
							// 288 работает, кнопка Chat остаётся активной
							width: 288,
							maxWidth: 'calc(100vw - 2rem)',
							height: 520,
							maxHeight: 'calc(100dvh - 184px)',
							zIndex: 30,
						}}
					>
						<iframe
							src={`https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(parentHost)}&darkpopout`}
							title={`Чат канала ${channel}`}
							tabIndex={0}
							className='flex-1 w-full min-h-0 border-0'
						/>
					</div>,
					document.body,
				)}

			{/* мини-окно: выбрать виджет из «Моих виджетов» и добавить на холст */}
			{widgetPickerOpen && (
				<div className='fixed inset-0 z-[70] flex items-center justify-center p-4'>
					<div
						className='absolute inset-0 bg-black/60'
						onClick={() => setWidgetPickerOpen(false)}
					/>
					<div className='relative w-full max-w-md rounded-2xl border border-border bg-panel p-4 shadow-2xl pop-in'>
						<div className='flex items-start justify-between gap-3'>
							<div className='min-w-0'>
								<h3 className='text-sm font-semibold text-[color:var(--c-on-bg)]'>
									Добавить виджет
								</h3>
								<p className='mt-0.5 text-[11px] leading-relaxed text-gray-500'>
									Выбери виджет из «Моих виджетов» — он появится на холсте.
								</p>
							</div>
							<button
								onClick={() => setWidgetPickerOpen(false)}
								aria-label='Закрыть'
								className='w-8 h-8 shrink-0 rounded-lg text-gray-400 hover:text-white hover:bg-border flex items-center justify-center'
							>
								<X size={15} />
							</button>
						</div>

						{widgetLibrary.length === 0 ? (
							<div className='mt-3 rounded-xl border border-dashed border-border bg-bg/50 p-4 text-center'>
								<Blocks size={22} className='mx-auto text-gray-600' />
								<p className='mt-2 text-sm text-gray-400'>
									В «Моих виджетах» пока пусто
								</p>
								<p className='mt-1 text-[11px] leading-relaxed text-gray-500'>
									Открой библиотеку и нажми «Добавить» на шаблоне — он появится
									здесь.
								</p>
								<button
									onClick={() => {
										setWidgetPickerOpen(false)
										setTab('widgets')
									}}
									className='mt-3 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg'
								>
									Открыть «Мои виджеты»
								</button>
							</div>
						) : (
							<div className='mt-3 max-h-[55vh] overflow-y-auto space-y-1.5'>
								{widgetLibrary.map(def => (
									<button
										key={def.id}
										onClick={() => {
											setWidgetPickerOpen(false)
											addWidgetToCanvas(def)
										}}
										className='w-full flex items-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2 text-left hover:border-accent2/50 hover:bg-accent2/5 transition-colors'
									>
										<span className='w-8 h-8 shrink-0 rounded-lg bg-accent2/10 text-accent2 flex items-center justify-center'>
											<Blocks size={15} />
										</span>
										<span className='min-w-0 flex-1'>
											<span className='block truncate text-sm font-medium text-[color:var(--c-on-bg)]'>
												{def.name}
											</span>
											<span className='mt-0.5 block text-[10px] text-gray-500'>
												{def.width}×{def.height} · {def.variables.length} перем.
											</span>
										</span>
										<Plus size={15} className='shrink-0 text-gray-500' />
									</button>
								))}
							</div>
						)}

						<div className='mt-3 flex items-center justify-between gap-2 border-t border-border pt-3'>
							<span className='text-[10px] leading-relaxed text-gray-500'>
								Код и переменные — в редакторе виджета
							</span>
							<button
								onClick={() => {
									setWidgetPickerOpen(false)
									setTab('widgets')
								}}
								className='shrink-0 text-xs text-accent2 hover:underline'
							>
								Открыть библиотеку
							</button>
						</div>
					</div>
				</div>
			)}

			{/* шит источника: одна кнопка «Картинка»/«Видео» → выбор «с ПК» или URL */}
			{addSheet && (
				<>
					<div
						className={`fixed inset-0 z-40 ${isMobile || betaUI ? 'bg-black/40' : 'bg-transparent'} ${addSheetClosing ? 'fade-out' : 'fade-in'}`}
						onClick={closeAddSheet}
					/>
					<div
						className={`fixed z-50 bg-panel border border-border rounded-2xl p-3 space-y-2 shadow-xl ${
							addSheetClosing
								? isMobile || betaUI
									? 'pop-out'
									: 'fade-out'
								: isMobile || betaUI
									? 'pop-in'
									: 'sheet-slide-in'
						} ${
							isMobile
								? 'left-3 right-3'
								: betaUI
									? 'left-1/2 -translate-x-1/2 w-80'
									: 'w-80'
						}`}
						style={
							isMobile
								? {
										bottom: 'calc(76px + env(safe-area-inset-bottom))',
										transformOrigin: 'bottom center',
									}
								: betaUI
									? { bottom: '96px', transformOrigin: 'bottom center' }
									: {
											// привычная панель: окно выезжает справа от левого меню
											top: '120px',
											left: sidebarOpen ? 296 : 16,
											transformOrigin: 'top left',
										}
						}
					>
						<p className='text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 pt-1'>
							Добавить:{' '}
							{addSheet === 'image'
								? 'картинку'
								: addSheet === 'video'
									? 'видео'
									: 'звук'}
						</p>
						<button
							onClick={() => {
								const kind = addSheet
								closeAddSheet()
								if (kind === 'image') addImagePC()
								else if (kind === 'video') addVideoPC()
								else addAudioPC()
							}}
							className='w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm rounded-xl transition-colors'
						>
							<Upload size={15} />
							{isMobile ? 'Файл с устройства' : 'С ПК'}
						</button>
						<button
							onClick={() => {
								const kind = addSheet
								closeAddSheet()
								if (kind === 'image') addImageUrl()
								else if (kind === 'video') addVideoUrl()
								else addAudioUrl()
							}}
							className='w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-border hover:bg-gray-600 text-white text-sm rounded-xl transition-colors'
						>
							<Link2 size={15} />
							Вставить ссылку (URL)
						</button>
						<button
							onClick={closeAddSheet}
							className='w-full px-3 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors'
						>
							Отмена
						</button>
					</div>
				</>
			)}

			{/* модалка YouTube-плейлиста: несколько ссылок → очередь с автопереходом */}
			{playlistOpen && (
				<div className='fixed inset-0 z-[70] flex items-center justify-center p-4'>
					<div
						className='absolute inset-0 bg-black/60 fade-in'
						onClick={() => setPlaylistOpen(false)}
					/>
					<div className='relative w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-panel p-4 sm:p-5 shadow-2xl'>
						<div className='flex items-start gap-2 mb-3'>
							<span className='w-9 h-9 shrink-0 rounded-xl bg-accent/15 text-accent2 flex items-center justify-center'>
								<ListVideo size={18} />
							</span>
							<div className='min-w-0 flex-1'>
								<h3 className='text-sm font-semibold text-[color:var(--c-on-bg)]'>
									YouTube плейлист
								</h3>
								<p className='mt-0.5 text-xs leading-relaxed text-gray-500'>
									Можно вставить ссылку готового плейлиста YouTube или несколько
									отдельных видео — после окончания ролика автоматически
									запустится следующий.
								</p>
							</div>
							<button
								onClick={() => setPlaylistOpen(false)}
								title='Закрыть'
								aria-label='Закрыть'
								className='w-7 h-7 shrink-0 rounded-lg text-gray-400 hover:text-white hover:bg-border flex items-center justify-center'
							>
								×
							</button>
						</div>
						<label className='text-xs text-gray-500 block mb-1'>
							Ссылка готового плейлиста
						</label>
						<div className='flex flex-col sm:flex-row gap-2'>
							<input
								type='text'
								value={playlistUrl}
								onChange={e => {
									setPlaylistUrl(e.target.value)
									if (playlistError) setPlaylistError('')
								}}
								placeholder='https://youtube.com/playlist?list=...'
								onKeyDown={e => {
									if (e.key === 'Enter') {
										e.preventDefault()
										addReadyYoutubePlaylist()
									}
								}}
								className='flex-1 min-w-0 px-3 py-2 bg-bg border border-border rounded-lg text-xs font-mono'
							/>
							<button
								onClick={addReadyYoutubePlaylist}
								className='px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors shrink-0'
							>
								Добавить плейлист
							</button>
						</div>
						<div className='my-3 flex items-center gap-2'>
							<div className='h-px flex-1 bg-border' />
							<span className='text-[10px] uppercase tracking-wide text-gray-600'>
								или несколько видео
							</span>
							<div className='h-px flex-1 bg-border' />
						</div>
						<label className='text-xs text-gray-500 block mb-1'>
							Ссылки на видео — по одной в строке
						</label>
						<textarea
							value={playlistText}
							onChange={e => {
								setPlaylistText(e.target.value)
								if (playlistError) setPlaylistError('')
							}}
							rows={6}
							placeholder={
								'https://youtu.be/AAAAAAAAAAA\nhttps://youtu.be/BBBBBBBBBBB\nhttps://youtube.com/watch?v=CCCCCCCCCCC'
							}
							className='w-full resize-y px-3 py-2 bg-bg border border-border rounded-lg text-xs font-mono leading-relaxed'
						/>
						<button
							onClick={() => setPlaylistLoopNew(v => !v)}
							className='mt-2 w-full flex items-center justify-between px-3 py-2 bg-bg border border-border rounded-lg text-sm'
						>
							<span>Повторять после последнего</span>
							<span
								className={`w-9 h-5 rounded-full relative shrink-0 ${playlistLoopNew ? 'bg-green-500' : 'bg-gray-600'}`}
							>
								<span
									className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
									style={{ left: playlistLoopNew ? 18 : 2 }}
								/>
							</span>
						</button>
						{playlistError && (
							<p className='mt-2 text-xs text-red-400'>{playlistError}</p>
						)}
						<div className='mt-3 flex gap-2'>
							<button
								onClick={addYoutubePlaylist}
								className='flex-1 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
							>
								Добавить очередь
							</button>
							<button
								onClick={() => setPlaylistOpen(false)}
								className='px-3 py-2 bg-border hover:bg-gray-600 text-white text-sm rounded-lg transition-colors'
							>
								Отмена
							</button>
						</div>
					</div>
				</div>
			)}

			{/* мобильная шторка свойств выбранного элемента */}
			{isMobile && sheetOpen && selected && (
				<div
					className='fixed left-0 right-0 z-40 max-h-[46dvh] overflow-y-auto bg-panel border-t border-border p-4'
					style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
				>
					<div className='flex items-center justify-between mb-3'>
						<span className='text-xs font-semibold text-gray-400 uppercase tracking-wide'>
							Свойства: {selected.type}
						</span>
						<div className='flex items-center gap-2'>
							<button
								onClick={() => {
									remember()
									emit('element:delete', selected.id)
									setSelectedId(null)
									setSheetOpen(false)
								}}
								className='px-2 py-1 text-xs text-red-400 border border-red-900/50 rounded-lg'
							>
								Удалить
							</button>
							<button
								onClick={() => setSheetOpen(false)}
								className='w-7 h-7 rounded-lg bg-border text-gray-400 hover:text-white'
							>
								✕
							</button>
						</div>
					</div>
					<PropertyEditor
						el={selected}
						update={partial => updateElement(selected.id, partial)}
						emit={emit}
						onEditWidget={editWidgetFromElement}
					/>
				</div>
			)}

			{/* кто сейчас на странице: ник с Twitch и роль — камера у автора панели,
			    меч у модератора, монитор у подключённого оверлея (OBS) */}
			{usersOpen && (
				<>
					<div
						className='fixed inset-0 z-40'
						onClick={() => setUsersOpen(false)}
					/>
					<div className='fixed top-14 right-2 z-50 w-64 max-w-[92vw] rounded-xl border border-border bg-panel p-2 shadow-xl'>
						<div className='px-2 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide'>
							Сейчас на странице
						</div>
						{users.length === 0 && (
							<p className='px-2 py-3 text-xs text-gray-600'>Никого нет</p>
						)}
						{users.map(u => (
							<div
								key={u.role + ':' + u.login}
								className='flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-border/60'
								title={
									u.role === 'streamer'
										? 'Автор панели'
										: u.role === 'moderator'
											? 'Модератор'
											: 'Оверлей в OBS (гость)'
								}
							>
								<span className='shrink-0 text-gray-300'>
									{u.role === 'streamer' ? (
										<CameraIcon />
									) : u.role === 'moderator' ? (
										<SwordIcon />
									) : (
										<MonitorIcon />
									)}
								</span>
								<span className='flex-1 truncate text-sm text-gray-200'>
									{u.login}
								</span>
								{u.connections > 1 && (
									<span className='shrink-0 text-[10px] text-gray-500'>
										×{u.connections}
									</span>
								)}
								<span className='shrink-0 text-[10px] text-gray-500'>
									{u.role === 'streamer'
										? 'автор'
										: u.role === 'moderator'
											? 'модератор'
											: 'оверлей'}
								</span>
							</div>
						))}
					</div>
				</>
			)}

			{emoteOpen && (
				<div
					className='fixed inset-0 z-50 bg-black/60 flex items-center justify-center'
					onMouseDown={() => setEmoteOpen(false)}
				>
					<div
						className='bg-panel border border-border rounded-xl w-[620px] max-w-[94vw] max-h-[78vh] flex flex-col'
						onMouseDown={e => e.stopPropagation()}
					>
						<div className='flex items-center justify-between px-4 py-3 border-b border-border'>
							<h3 className='text-sm font-semibold'>
								Смайлики{' '}
								{channel ? (
									<span className='text-gray-500 font-normal'>
										· канал {channel}
									</span>
								) : (
									<span className='text-gray-500 font-normal'>
										· только глобальные
									</span>
								)}
							</h3>
							<div className='flex items-center gap-1'>
								<button
									onClick={() => openEmotePicker(true)}
									title='Обновить — подтянуть свежие смайлики'
									className='w-7 h-7 rounded-lg hover:bg-border text-gray-400 hover:text-white transition-colors'
								>
									↻
								</button>
								<button
									onClick={() => setEmoteOpen(false)}
									className='w-7 h-7 rounded-lg hover:bg-border text-gray-400 hover:text-white transition-colors'
								>
									✕
								</button>
							</div>
						</div>
						<div className='flex items-center gap-2 px-4 py-2 border-b border-border'>
							<input
								value={emoteQuery}
								onChange={e => setEmoteQuery(e.target.value)}
								placeholder='Поиск по названию…'
								className='flex-1 px-3 py-1.5 bg-bg border border-border rounded-lg text-sm'
							/>
							<div className='flex gap-1'>
								{(
									[
										['all', 'Все'],
										['twitch', 'Twitch'],
										['7tv', '7TV'],
										['bttv', 'BTTV'],
										['ffz', 'FFZ'],
									] as const
								).map(([k, label]) => (
									<button
										key={k}
										onClick={() => setEmotePlatform(k)}
										className={`px-2 py-1 text-xs rounded-lg transition-colors ${emotePlatform === k ? 'bg-accent text-white' : 'text-gray-400 hover:bg-border'}`}
									>
										{label}
									</button>
								))}
							</div>
						</div>
						<div className='flex-1 overflow-y-auto p-3'>
							{emoteNotes.map((n, i) => (
								<p
									key={i}
									className='text-xs text-amber-400/90 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2 mb-3'
								>
									{n}
								</p>
							))}
							{emoteLoading ? (
								<p className='text-sm text-gray-500 text-center py-10'>
									Загружаем смайлики с Twitch, 7TV, BetterTTV и FrankerFaceZ…
								</p>
							) : emoteError && emotes.length === 0 ? (
								<p className='text-sm text-red-400 text-center py-10'>
									{emoteError}
								</p>
							) : (
								(() => {
									const q = emoteQuery.trim().toLowerCase()
									const list = emotes.filter(
										e =>
											(emotePlatform === 'all' ||
												e.platform === emotePlatform) &&
											(!q || e.code.toLowerCase().includes(q)),
									)
									if (!list.length)
										return (
											<p className='text-sm text-gray-500 text-center py-10'>
												Ничего не найдено
											</p>
										)
									return (
										<div className='grid grid-cols-6 gap-1.5'>
											{list.slice(0, 300).map((e, i) => (
												<button
													key={e.platform + e.code + i}
													onClick={() => addEmote(e)}
													title={`${e.code} · ${e.platform}${e.scope === 'personal' ? ' · набор автора' : e.scope === 'channel' ? ' · канал' : ''}`}
													className='flex flex-col items-center gap-1 px-1 py-2 rounded-lg hover:bg-border transition-colors'
												>
													<img
														src={e.url}
														alt={e.code}
														className='w-9 h-9 object-contain'
														loading='lazy'
														decoding='async'
													/>
													<span className='text-[10px] text-gray-500 truncate w-full text-center'>
														{e.code}
													</span>
												</button>
											))}
										</div>
									)
								})()
							)}
						</div>
						<div className='px-4 py-2 border-t border-border text-[10px] text-gray-500'>
							Клик по смайлику — добавить на холст
							{emotes.length ? ` · синхронизировано: ${emotes.length}` : ''}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// Карточка элемента в списке: превью, видимость и удаление. Одна и та же
// в обычной панели и в минималистичном меню.
function ElementCard({
	el,
	selected,
	active,
	onSelect,
	onToggleVisible,
	onDelete,
}: {
	el: StreamElement
	selected: boolean
	active: boolean
	onSelect: () => void
	onToggleVisible: () => void
	onDelete: () => void
}) {
	return (
		<div
			onClick={onSelect}
			className={`group relative rounded-lg border overflow-hidden cursor-pointer transition-colors ${
				selected
					? 'border-accent2'
					: active
						? 'border-accent2/60'
						: 'border-border hover:border-gray-500'
			}`}
		>
			<div className='relative h-16 bg-bg flex items-center justify-center overflow-hidden'>
				<ElementThumb el={el} />
			</div>
			<div className='flex items-center gap-0.5 px-1 py-0.5 bg-panel'>
				<span className='flex-1 truncate text-[10px] text-gray-400'>
					{elementLabel(el)}
				</span>
				<button
					onClick={e => {
						e.stopPropagation()
						onToggleVisible()
					}}
					title={el.visible ? 'Скрыть' : 'Показать'}
					aria-label={el.visible ? 'Скрыть элемент' : 'Показать элемент'}
					className='shrink-0 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:bg-border hover:text-white transition-colors'
				>
					{el.visible ? <Eye size={12} /> : <EyeOff size={12} />}
				</button>
				<button
					onClick={e => {
						e.stopPropagation()
						onDelete()
					}}
					title='Удалить'
					aria-label='Удалить элемент'
					className='shrink-0 w-5 h-5 flex items-center justify-center rounded text-red-400 hover:bg-red-950/40 transition-colors'
				>
					<Trash2 size={12} />
				</button>
				</div>
				{el.locked && (
				<span
					className='absolute top-0.5 left-0.5 text-gray-300'
					title='Заблокирован от перетаскивания'
				>
					<Lock size={11} />
				</span>
			)}
		</div>
	)
}

// Кнопка нижнего минималистичного меню: только иконка, подпись в подсказке
function DockButton({
	label,
	onClick,
	children,
}: {
	label: string
	onClick: () => void
	children: ReactNode
}) {
	return (
		<button
			onClick={onClick}
			title={label}
			aria-label={label}
			className='w-9 h-9 rounded-xl flex items-center justify-center text-gray-300 hover:bg-border hover:text-white transition-colors'
		>
			{children}
		</button>
	)
}

// Подпись элемента в списке: вместо «data:image/png;base64,iVBOR…» — понятное слово
function elementLabel(el: StreamElement): string {
	if (el.type === 'widget') return el.widget?.name || 'Виджеты'
	if (el.type === 'text') {
		const t = (el.text || '').trim().replace(/\s+/g, ' ')
		return t ? t.slice(0, 40) : 'Текст'
	}
	if (el.type === 'timer') return el.timerLabel?.trim() || 'Таймер'
	if (el.type === 'audio') {
		const src = el.src || ''
		if (src.startsWith('data:')) return 'Звук с ПК'
		try {
			const u = new URL(src)
			const tail = u.pathname.split('/').filter(Boolean).pop()
			return tail && !/^\d+$/.test(tail) ? decodeURIComponent(tail) : 'Звук'
		} catch {
			return 'Звук'
		}
	}
	const src = el.src || ''
	if (src.startsWith('data:')) {
		if (el.type === 'video') return 'Видео с ПК'
		if (el.type === 'gif') return 'Гифка с ПК'
		return 'Картинка с ПК'
	}
	try {
		const u = new URL(src)
		if (el.type === 'iframe') return u.hostname.replace(/^www\./, '') || 'Сайт'
		const tail = u.pathname.split('/').filter(Boolean).pop()
		// у ссылок вида /600/400 «хвост» — просто число: домен понятнее
		if (!tail || /^d+$/.test(tail) || /^[0-9a-f]{8,}$/i.test(tail))
			return u.hostname.replace(/^www./, '')
		return decodeURIComponent(tail)
	} catch {
		return el.type
	}
}

// Мини-превью в списке: у картинки/гифки/видео показываем сам файл, у остальных —
// иконку по типу (в списке это понятнее, чем первые символы URL)
function ElementThumb({ el }: { el: StreamElement }) {
	if (el.type === 'widget')
		return (
			<span className='absolute inset-0 flex items-center justify-center bg-[#14141c] text-accent2'>
				<Blocks size={22} />
			</span>
		)
	if (el.type === 'image' || el.type === 'gif')
		return (
			<img
				src={el.src}
				alt=''
				loading='lazy'
				draggable={false}
				className='w-full h-full object-cover'
			/>
		)
	if (el.type === 'video')
		return (
			<video
				src={el.src}
				muted
				preload='metadata'
				playsInline
				className='w-full h-full object-cover'
			/>
		)
	if (el.type === 'text')
		// текст рисуем его собственным цветом (часто белым) — подложка всегда тёмная:
		// на светлой теме белый текст на светлом фоне был бы невидим
		return (
			<span className='absolute inset-0 flex items-center justify-center bg-[#14141c]'>
				<span
					className='px-1 text-center leading-tight'
					style={{
						color: el.color || '#fff',
						fontFamily: el.fontFamily || undefined,
						fontWeight:
							(el.fontWeight as React.CSSProperties['fontWeight']) || 'normal',
						fontStyle: el.italic ? 'italic' : 'normal',
						textDecoration: el.underline ? 'underline' : 'none',
						fontSize: 10,
						display: '-webkit-box',
						WebkitLineClamp: 3,
						WebkitBoxOrient: 'vertical',
						overflow: 'hidden',
					}}
				>
					{el.text}
				</span>
			</span>
		)
	if (el.type === 'audio')
		return (
			<span className='absolute inset-0 flex items-center justify-center bg-[#14141c] text-accent2'>
				<Volume2 size={22} />
			</span>
		)
	if (el.type === 'timer')
		return (
			<span className='text-[10px] text-gray-400'>
				⏱ {el.timerLabel || formatTime(el.duration || 0)}
			</span>
		)
	const info = parseMediaUrl(el.src || '')
	if (info)
		return (
			<span className='text-lg'>{info.kind === 'youtube' ? '▶️' : '🟣'}</span>
		)
	let host = ''
	try {
		host = new URL(el.src || '').hostname.replace(/^www\./, '')
	} catch {}
	return (
		<span className='flex flex-col items-center gap-0.5 min-w-0'>
			<span className='text-lg'>🌐</span>
			{host && (
				<span className='text-[9px] text-gray-500 truncate max-w-full'>
					{host}
				</span>
			)}
		</span>
	)
}

// Иконки списка участников и кнопки «кто на странице» (контурные, под тему).
// Кнопка — силуэт человека со щитом, как на макете
function UsersIcon({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<circle cx='9' cy='8' r='3.2' />
			<path d='M3.5 19.5c0-3 2.5-5 5.5-5 .9 0 1.8.2 2.6.6' />
			<path d='M16.5 11.5 20 13v3.2c0 2-1.5 3.6-3.5 4.3-2-.7-3.5-2.3-3.5-4.3V13z' />
		</svg>
	)
}

// камера — автор панели (стример)
function CameraIcon({ size = 15 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<rect x='2.5' y='6.5' width='12' height='11' rx='2.5' />
			<path d='M14.5 11.2l5-2.7v7l-5-2.7z' />
		</svg>
	)
}

// меч — модератор
function SwordIcon({ size = 15 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<path d='M14.5 17.5 3 6V3h3l11.5 11.5' />
			<path d='M13 19l6-6' />
			<path d='M16 16l4 4' />
			<path d='M19 21l2-2' />
		</svg>
	)
}

// монитор — оверлей в OBS (гость без ника Twitch)
function MonitorIcon({ size = 15 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<rect x='2.5' y='4' width='19' height='13' rx='2.5' />
			<path d='M9 20.5h6' />
			<path d='M12 17v3.5' />
		</svg>
	)
}

// Пределы выбираемого фрагмента: короче 0.2 с — уже не звук, а щелчок;
// длиннее 10 с — риск залить эфир длинным треком
const TRIM_MAX = 10
const TRIM_MIN = 0.2
// 2 МБ хватает на короткий MP3; весь файл всё равно уходит в стейт как base64
const MAX_SOUND_FILE = 2 * 1024 * 1024

function fmtSoundTime(sec: number): string {
	const m = Math.floor(sec / 60)
	const rest = Math.max(0, sec - m * 60)
	return `${m}:${rest.toFixed(1).padStart(4, '0')}`
}

function round2(v: number): number {
	return Math.round(v * 100) / 100
}

// Волна с двумя краями. Края меняют границы фрагмента, перетаскивание середины
// двигает весь фрагмент по дорожке. Пока тянут — показываем черновик, чтобы
// не гонять состояние на сервер на каждое движение мыши; сохраняем на отпускании
function SoundTrim({
	analysis,
	start,
	duration,
	onChange,
}: {
	analysis: SoundAnalysis
	start: number
	duration: number
	onChange: (start: number, duration: number) => void
}) {
	const trackRef = useRef<HTMLDivElement | null>(null)
	const [draft, setDraft] = useState<{ start: number; end: number } | null>(
		null,
	)
	const total = analysis.duration
	const maxLen = Math.min(TRIM_MAX, total)
	const minLen = Math.min(TRIM_MIN, maxLen)
	const safeStart = Math.min(Math.max(0, start), Math.max(0, total - minLen))
	const safeEnd = Math.min(
		total,
		safeStart + Math.min(Math.max(minLen, duration), maxLen),
	)
	const region = draft ?? { start: safeStart, end: safeEnd }

	const beginDrag =
		(mode: 'start' | 'end' | 'move') => (e: React.PointerEvent) => {
			if (e.button !== 0 || !(total > 0)) return
			e.preventDefault()
			e.stopPropagation()
			const track = trackRef.current
			if (!track) return
			const rect = track.getBoundingClientRect()
			const init = { ...region }
			const startX = e.clientX
			let latest = init
			const onMove = (ev: PointerEvent) => {
				const dt = ((ev.clientX - startX) / Math.max(1, rect.width)) * total
				let a = init.start
				let b = init.end
				const len = init.end - init.start
				if (mode === 'move') {
					// весь фрагмент едет, не выходя за пределы файла
					a = Math.min(Math.max(0, init.start + dt), Math.max(0, total - len))
					b = a + len
				} else if (mode === 'start') {
					const lo = Math.max(0, init.end - maxLen)
					const hi = init.end - minLen
					a = Math.min(Math.max(lo, init.start + dt), hi)
					b = init.end
				} else {
					const lo = init.start + minLen
					const hi = Math.min(total, init.start + maxLen)
					b = Math.min(Math.max(lo, init.end + dt), hi)
					a = init.start
				}
				latest = { start: a, end: b }
				setDraft(latest)
			}
			const finish = () => {
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', finish)
				window.removeEventListener('pointercancel', finish)
				setDraft(null)
				onChange(round2(latest.start), round2(latest.end - latest.start))
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', finish)
			window.addEventListener('pointercancel', finish)
		}

	const left = total > 0 ? (region.start / total) * 100 : 0
	const width = total > 0 ? ((region.end - region.start) / total) * 100 : 0
	const n = Math.max(1, analysis.peaks.length)
	return (
		<div className='space-y-1 min-w-0'>
			<div
				ref={trackRef}
				className='relative h-14 w-full overflow-hidden rounded-lg border border-border bg-bg select-none touch-none'
			>
				<svg
					viewBox={`0 0 ${n} 100`}
					preserveAspectRatio='none'
					className='absolute inset-0 h-full w-full pointer-events-none'
					aria-hidden='true'
				>
					{analysis.peaks.map((p, i) => {
						const h = Math.max(2, p * 92)
						return (
							<rect
								key={i}
								x={i + 0.14}
								y={50 - h / 2}
								width={0.72}
								height={h}
								rx={0.3}
								fill='rgb(var(--c-accent2))'
								opacity={0.5}
							/>
						)
					})}
				</svg>
				{/* затемнение вне фрагмента: границы видно сразу, не вглядываясь */}
				<div
					className='absolute inset-y-0 left-0 bg-black/45 pointer-events-none'
					style={{ width: `${left}%` }}
				/>
				<div
					className='absolute inset-y-0 right-0 bg-black/45 pointer-events-none'
					style={{ width: `${Math.max(0, 100 - left - width)}%` }}
				/>
				<div
					onPointerDown={beginDrag('move')}
					title='Перетащите фрагмент по волне'
					className='absolute inset-y-0 z-10 cursor-grab active:cursor-grabbing touch-none border-y-2 border-accent bg-accent/20'
					style={{ left: `${left}%`, width: `${width}%` }}
				>
					<div
						onPointerDown={beginDrag('start')}
						title='Начало фрагмента'
						className='absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize touch-none'
					>
						<span className='absolute inset-y-1 left-0 w-1.5 rounded-full bg-accent2 border border-white/60 shadow' />
					</div>
					<div
						onPointerDown={beginDrag('end')}
						title='Конец фрагмента'
						className='absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize touch-none'
					>
						<span className='absolute inset-y-1 right-0 w-1.5 rounded-full bg-accent2 border border-white/60 shadow' />
					</div>
				</div>
			</div>
			<div className='flex items-center justify-between gap-1 text-[10px] text-gray-500 tabular-nums'>
				<span>{fmtSoundTime(region.start)}</span>
				<span className='text-accent2 font-medium'>
					{(region.end - region.start).toFixed(1)} с
				</span>
				<span>{fmtSoundTime(region.end)}</span>
			</div>
		</div>
	)
}

// Звук окончания таймера: выбор файла с ПК (в R2; без R2 — data-URL вместе с
// элементом, поэтому звук слышен и в панели, и на оверлее у стримера), точный
// фрагмент на волне и громкость. Блок компактный — живёт в узкой колонке свойств (w-72)
function TimerSoundControls({
	el,
	update,
}: {
	el: StreamElement
	update: (partial: Partial<StreamElement>) => void
}) {
	const [busy, setBusy] = useState(false)
	const [analysis, setAnalysis] = useState<SoundAnalysis | null>(null)
	const [waveError, setWaveError] = useState('')
	const hasSound = !!el.soundSrc
	const volume = el.soundVolume ?? 1

	// волну строим из самого файла: декодируем data-URL в AudioBuffer и считаем пики
	useEffect(() => {
		if (!el.soundSrc) {
			setAnalysis(null)
			setWaveError('')
			return
		}
		let alive = true
		setAnalysis(null)
		setWaveError('')
		analyzeSound(el.soundSrc, 180)
			.then(a => {
				if (alive) setAnalysis(a)
			})
			.catch(() => {
				if (alive)
					setWaveError(
						'Не удалось построить волну. Попробуйте MP3, WAV или OGG.',
					)
			})
		return () => {
			alive = false
		}
	}, [el.soundSrc])

	// файл короче 10 с — по умолчанию выделяем его целиком; длиннее — первые 10 с.
	// Старые сохранённые значения могли оказаться за пределами нового файла:
	// подрезаем их, иначе на оверлее проигрывался бы пустой/лишний фрагмент
	useEffect(() => {
		if (!analysis || !(analysis.duration > 0)) return
		const total = analysis.duration
		const len = Math.min(TRIM_MAX, total)
		const start = Math.max(0, el.soundStart ?? 0)
		const outOfRange =
			el.soundDuration === undefined ||
			el.soundDuration > total + 0.05 ||
			start > Math.max(0, total - Math.min(TRIM_MIN, total))
		if (!outOfRange) return
		update({
			soundStart: round2(Math.min(start, Math.max(0, total - len))),
			soundDuration: round2(Math.max(Math.min(TRIM_MIN, total), len)),
		})
	}, [analysis, el.soundStart, el.soundDuration])

	const total = analysis?.duration ?? 0
	const maxLen = total > 0 ? Math.min(TRIM_MAX, total) : TRIM_MAX
	const minLen = total > 0 ? Math.min(TRIM_MIN, total) : TRIM_MIN
	const effLen = Math.min(
		maxLen,
		Math.max(minLen, el.soundDuration ?? (total > 0 ? maxLen : 5)),
	)
	const effStart =
		total > 0
			? Math.min(
					Math.max(0, el.soundStart ?? 0),
					Math.max(0, total - Math.min(effLen, total)),
				)
			: Math.max(0, el.soundStart ?? 0)

	const pick = () => {
		const input = document.createElement('input')
		input.type = 'file'
		input.accept = 'audio/*'
		input.style.display = 'none'
		let dropped = false
		const drop = () => {
			if (dropped) return
			dropped = true
			input.remove()
		}
		input.addEventListener('cancel', drop)
		input.addEventListener('change', () => {
			const f = input.files?.[0]
			if (!f) {
				drop()
				return
			}
			// звук уходит в R2 (или base64, если R2 не настроен) и на оверлей
			if (f.size > MAX_SOUND_FILE) {
				alert(
					'Файл больше 2 МБ. Для таймера достаточно короткого MP3 — фрагмент всё равно обрезается до 10 секунд.',
				)
				drop()
				return
			}
			setBusy(true)
			void (async () => {
				try {
					// новый файл — новый фрагмент: старые границы к нему не относятся.
					// 10 с — заведомо допустимая длина, после анализа она ужмётся под файл
					update({
						soundSrc: await fileToSrc(f),
						soundStart: 0,
						soundDuration: TRIM_MAX,
						soundVolume: volume,
					})
				} catch {
					alert('Не удалось прочитать файл. Попробуйте MP3, WAV или OGG.')
				} finally {
					setBusy(false)
					drop()
				}
			})()
		})
		document.body.appendChild(input)
		input.click()
		window.addEventListener(
			'focus',
			() =>
				setTimeout(() => {
					if (!input.files?.length) drop()
				}, 500),
			{ once: true },
		)
	}

	const playPreview = () =>
		playTimerSound({
			src: el.soundSrc,
			volume,
			duration: effLen,
			start: effStart,
		})

	return (
		<div className='pt-2 border-t border-border space-y-2 min-w-0'>
			<div className='flex items-start justify-between gap-2'>
				<div className='min-w-0'>
					<label className='text-xs text-gray-500 block'>Звук окончания</label>
					<p className='text-[10px] text-gray-600 leading-tight'>
						{hasSound
							? 'Свой файл · точный фрагмент выбирается на волне'
							: 'По умолчанию — встроенный сигнал'}
					</p>
				</div>
				{hasSound && (
					<button
						onClick={() =>
							// пустая строка, а не undefined: undefined-поля не уходят
							// в JSON и на сервере остался бы старый файл
							update({ soundSrc: '', soundStart: 0, soundDuration: 0 })
						}
						title='Вернуть встроенный сигнал'
						className='shrink-0 w-7 h-7 text-xs text-red-400 border border-red-900/50 rounded-lg hover:bg-red-950/40'
					>
						✕
					</button>
				)}
			</div>
			<div className='flex gap-1.5'>
				<button
					onClick={pick}
					disabled={busy}
					className='flex-1 min-w-0 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg disabled:opacity-50'
				>
					{busy ? 'Загрузка…' : hasSound ? 'Заменить файл' : 'Выбрать с ПК'}
				</button>
				{hasSound && (
					<button
						onClick={playPreview}
						title='Прослушать выбранный фрагмент'
						className='flex-1 min-w-0 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
					>
						▶ Прослушать
					</button>
				)}
			</div>
			{hasSound && analysis && (
				<SoundTrim
					analysis={analysis}
					start={effStart}
					duration={effLen}
					onChange={(start, duration) =>
						update({ soundStart: start, soundDuration: duration })
					}
				/>
			)}
			{hasSound && !analysis && !waveError && (
				<p className='text-[10px] text-gray-600'>Строю волну…</p>
			)}
			{hasSound && waveError && (
				<p className='text-[10px] text-amber-400/90'>{waveError}</p>
			)}
			{hasSound && (
				<div className='flex items-center gap-2 min-w-0'>
					<label className='text-[11px] text-gray-500 shrink-0'>
						Громкость
					</label>
					<input
						type='range'
						min={0}
						max={100}
						value={Math.round(volume * 100)}
						onChange={e =>
							update({ soundVolume: Number(e.target.value) / 100 })
						}
						className='flex-1 min-w-0'
					/>
					<span className='text-[10px] text-gray-500 w-8 text-right shrink-0'>
						{Math.round(volume * 100)}%
					</span>
				</div>
			)}
			{hasSound && analysis && (
				<p className='text-[10px] text-gray-600 leading-tight'>
					Края — точные границы, середину можно перетаскивать по волне. Максимум
					10 с.
				</p>
			)}
		</div>
	)
}

function SunIcon() {
	return (
		<svg
			width='14'
			height='14'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<circle cx='12' cy='12' r='5' />
			<line x1='12' y1='1' x2='12' y2='3' />
			<line x1='12' y1='21' x2='12' y2='23' />
			<line x1='4.22' y1='4.22' x2='5.64' y2='5.64' />
			<line x1='18.36' y1='18.36' x2='19.78' y2='19.78' />
			<line x1='1' y1='12' x2='3' y2='12' />
			<line x1='21' y1='12' x2='23' y2='12' />
			<line x1='4.22' y1='19.78' x2='5.64' y2='18.36' />
			<line x1='18.36' y1='5.64' x2='19.78' y2='4.22' />
		</svg>
	)
}

function MoonIcon() {
	return (
		<svg
			width='14'
			height='14'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' />
		</svg>
	)
}

function PreviewElement({
	el,
	scale,
	interactive,
	mounted,
	mediaSt,
	chromeRegister,
	mediaToggle,
	mediaSelect,
	mediaCommand,
	onMediaState,
	onTwitchPlayer,
	channel,
}: {
	el: StreamElement
	scale: number
	interactive?: boolean
	mounted?: boolean
	mediaSt?: MediaSt
	chromeRegister?: (id: string, ctl: ChromeCtl | null) => void
	mediaToggle?: (id: string) => void
	mediaSelect?: (id: string) => void
	mediaCommand?: (id: string, cmd: string, value?: number) => void
	onMediaState?: (id: string, patch: Partial<MediaSt>) => void
	onTwitchPlayer?: (id: string, p: any | null) => void
	channel?: string | null
}) {
	// веб-шрифт текста подгружаем по требованию (у панели и оверлея — свои документы)
	useEffect(() => {
		if (el.type === 'text') ensureFontLoaded(el.fontFamily)
	}, [el.type, el.fontFamily])
	if (el.type === 'widget' && el.widget)
		return (
			<WidgetFrame
				widget={el.widget}
				values={el.widgetValues}
				isOverlay={false}
				channel={channel}
				elementId={el.id}
				background={
					el.bgColor && el.bgColor !== 'transparent'
						? colorWithOpacity(el.bgColor, el.bgOpacity ?? 1)
						: undefined
				}
			/>
		)
	if (el.type === 'image' || el.type === 'gif')
		return (
			<img
				src={el.src}
				alt=''
				className='w-full h-full object-fill pointer-events-none'
				draggable={false}
			/>
		)
	if (el.type === 'video') {
		// обычное видео (файл с ПК или прямая ссылка): свой плеер в превью + плашка
		// управления, как у YouTube/Twitch — раньше видео нельзя было даже поставить
		// на паузу или включить звук
		if (
			chromeRegister &&
			mediaToggle &&
			mediaSelect &&
			mediaCommand &&
			onMediaState
		)
			return (
				<>
					<VideoPreview el={el} onState={patch => onMediaState(el.id, patch)} />
					<MediaChrome
						el={el}
						kind='video'
						st={mediaSt}
						register={chromeRegister}
						toggle={mediaToggle}
						select={mediaSelect}
						command={mediaCommand}
					/>
				</>
			)
		return (
			<video
				src={el.src}
				className='w-full h-full object-fill pointer-events-none'
				muted
				loop
				autoPlay
				playsInline
			/>
		)
	}
	if (el.type === 'iframe') {
		const info = parseMediaUrl(el.src || '')
		if (
			info &&
			chromeRegister &&
			mediaToggle &&
			mediaSelect &&
			mediaCommand &&
			onTwitchPlayer
		) {
			// медиа (YouTube/Twitch): чистый кадр + своя панель управления;
			// iframe рендерится только после монтирования (origin известен только на клиенте)
			return (
				<>
					{mounted ? (
						info.kind === 'youtube' ? (
							<iframe
								src={youtubeEmbedUrl(
									info.id,
									window.location.origin,
									true,
									!!el.autoplay,
								)}
								title='media'
								data-id={el.id}
								className='w-full h-full'
								style={{ border: 0, pointerEvents: 'none' }}
								allow='autoplay; fullscreen'
								sandbox='allow-modals allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation'
							/>
						) : (
							<TwitchFrame el={el} onPlayer={onTwitchPlayer} />
						)
					) : (
						<div className='w-full h-full' style={{ background: '#000' }} />
					)}
					<MediaChrome
						el={el}
						kind={info.kind === 'youtube' ? 'youtube' : 'twitch'}
						st={mediaSt}
						register={chromeRegister}
						toggle={mediaToggle}
						select={mediaSelect}
						command={mediaCommand}
					/>
				</>
			)
		}
		const embedSrc = toEmbedUrl(el.src || '')
		// готовый YouTube-плейлист: включаем autoplay у самого YouTube,
		// иначе после добавления он стоит на постере и не переключает ролики.
		// Панель стартует без звука — браузер блокирует громкий автозапуск
		const autoplayPlaylist =
			!!el.autoplay && /\/embed\/videoseries/.test(embedSrc)
		return (
			<>
				<iframe
					src={
						autoplayPlaylist
							? `${embedSrc}${embedSrc.includes('?') ? '&' : '?'}autoplay=1&mute=1`
							: embedSrc
					}
					title='embed'
					data-id={el.id}
					className='w-full h-full'
					style={{ border: 0, pointerEvents: interactive ? 'auto' : 'none' }}
					allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
					allowFullScreen
				/>
				{/* частая причина «не работает вывод»: сайт запрещает встраивание
				    (Twitch-страница, YouTube-страница и т.п.) — говорим об этом прямо */}
				{!interactive && cannotBeFramed(el.src || '') && (
					<div className='absolute left-1 top-1 max-w-[92%] rounded-md bg-black/75 px-2 py-1 text-[10px] leading-tight text-amber-300 pointer-events-none'>
						⚠️ Сайт запрещает встраивание — в рамке он не откроется. Для Twitch
						нужна ссылка на канал, видео или клип, для YouTube — на видео
					</div>
				)}
			</>
		)
	}
	if (el.type === 'text')
		return (
			<div
				className='w-full h-full pointer-events-none'
				style={textBoxStyle(el, scale)}
			>
				{el.text}
			</div>
		)
	if (el.type === 'audio')
		return (
			<div className='w-full h-full flex items-center gap-2 rounded-lg border border-border bg-panel/95 px-3 text-gray-300'>
				<Volume2 size={18} className='text-accent2 shrink-0' />
				<div className='min-w-0'>
					<p className='text-xs font-medium truncate'>Звук</p>
					<p className='text-[10px] text-gray-500 truncate'>
						Проиграть — в свойствах
					</p>
				</div>
			</div>
		)
	if (el.type === 'timer') return <TimerPreview el={el} scale={1} />
	return null
}

// обычное видео в панели: играет локально и отдаёт своё состояние (позиция, звук,
// пауза) в общий поток медиа-состояний — благодаря этому плашка управления и
// ретрансляция на оверлей работают так же, как у YouTube/Twitch
function VideoPreview({
	el,
	onState,
}: {
	el: StreamElement
	onState: (patch: Partial<MediaSt>) => void
}) {
	const ref = useRef<HTMLVideoElement | null>(null)
	const report = useCallback(() => {
		const v = ref.current
		if (!v) return
		onState({
			vid: mediaKeyFor(el),
			kind: 'video',
			st: v.paused ? (v.ended ? 0 : 2) : 1,
			t: v.currentTime || 0,
			dur: isFinite(v.duration) ? v.duration : 0,
			muted: v.muted,
			vol: Math.round(v.volume * 100),
		})
	}, [el, onState])
	// смена ссылки на лету: начинаем воспроизведение заново (vid в состоянии
	// поменяется, поэтому прежние позиция/длительность к новому источнику не применятся)
	const srcRef = useRef(el.src)
	useEffect(() => {
		if (srcRef.current === el.src) return
		srcRef.current = el.src
		const v = ref.current
		if (!v) return
		v.load()
		void v.play().catch(() => {})
	}, [el.src])
	return (
		<video
			ref={ref}
			data-id={el.id}
			src={el.src}
			className='w-full h-full object-fill pointer-events-none'
			muted
			loop
			autoPlay
			playsInline
			onLoadedMetadata={report}
			onTimeUpdate={report}
			onPlay={report}
			onPause={report}
			onVolumeChange={report}
		/>
	)
}

function TimerPreview({ el, scale }: { el: StreamElement; scale: number }) {
	const [, force] = useState(0)
	const playedRef = useRef(false)

	useEffect(() => {
		if (!el.isRunning) return
		const i = setInterval(() => force(x => x + 1), 250)
		return () => clearInterval(i)
	}, [el.isRunning])

	const elapsedMs =
		el.isRunning && el.startTime
			? Math.max(0, Date.now() - serverClockLag.ms - el.startTime) // serverClockLag: часы устройства могут расходиться с серверными
			: el.elapsed || 0
	const elapsedSec = Math.floor(elapsedMs / 1000)
	const display =
		el.timerDirection === 'down' && el.duration
			? formatTime(Math.max(0, el.duration - elapsedSec))
			: formatTime(elapsedSec)
	// звук окончания — и в панели тоже (однократно на каждый запуск)
	const remaining =
		el.timerDirection === 'down' && el.duration
			? el.duration - elapsedSec
			: null
	if (remaining !== null && remaining <= 0) {
		if (el.isRunning && !playedRef.current) {
			playedRef.current = true
			playTimerSound({
				src: el.soundSrc,
				volume: el.soundVolume,
				duration: el.soundDuration,
				start: el.soundStart,
			})
		}
		if (!el.isRunning) playedRef.current = false
	} else {
		playedRef.current = false
	}
	const bg = colorWithOpacity(el.bgColor, el.bgOpacity ?? 1)

	return (
		<div className='w-full h-full flex flex-col items-center justify-center pointer-events-none overflow-hidden'>
			{el.timerLabel && (
				<div
					style={{
						fontSize: (el.fontSize || 40) * 0.5 * scale,
						color: el.color,
						fontWeight: el.fontWeight,
						background: bg,
						padding: '2px 8px',
						borderRadius: 4,
						marginBottom: 4,
					}}
				>
					{el.timerLabel}
				</div>
			)}
			<div
				style={{
					fontSize: (el.fontSize || 40) * scale,
					color: el.color || '#fff',
					fontWeight: el.fontWeight || 'bold',
					background: bg,
					padding: '4px 12px',
					borderRadius: 6,
					fontFamily: 'monospace',
					letterSpacing: 2,
					whiteSpace: 'nowrap',
				}}
			>
				{display}
			</div>
		</div>
	)
}

function formatTime(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds))
	const h = Math.floor(total / 3600)
	const m = Math.floor((total % 3600) / 60)
	const s = total % 60
	const mm = String(m).padStart(2, '0')
	const ss = String(s).padStart(2, '0')
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function PropertyEditor({
	el,
	update,
	emit,
	onEditWidget,
}: {
	el: StreamElement
	update: (partial: Partial<StreamElement>) => void
	emit: (e: string, d?: any) => void
	onEditWidget: (def: WidgetDefinition) => void
}) {
	// пока идёт обратный отсчёт, раз в полсекунды обновляем кнопку и подпись:
	// в конце она должна снова стать «Старт», даже если состояние не менялось
	const [, tick] = useState(0)
	useEffect(() => {
		if (el.type !== 'timer' || !el.isRunning) return
		const i = setInterval(() => tick(x => x + 1), 500)
		return () => clearInterval(i)
	}, [el.type, el.isRunning])
	// локальное прослушивание звука в панели (не отправляется на оверлей)
	const localAudioRef = useRef<HTMLAudioElement | null>(null)
	const [audioError, setAudioError] = useState('')
	useEffect(() => {
		setAudioError('')
	}, [el.id])
	useEffect(() => {
		if (localAudioRef.current)
			localAudioRef.current.volume = Math.max(
				0,
				Math.min(1, el.volume ?? 1),
			)
	}, [el.volume])
	useEffect(
		() => () => {
			const a = localAudioRef.current
			if (a) {
				a.pause()
				a.remove()
				a.src = ''
			}
			localAudioRef.current = null
		},
		[el.id],
	)
	const previewAudio = () => {
		setAudioError('')
		const a = localAudioRef.current ?? new Audio()
		localAudioRef.current = a
		// некоторые браузеры не запускают отвязанный Audio: держим скрытый
		// элемент в документе, чтобы play() по клику срабатывал стабильно
		if (!a.isConnected) {
			a.style.display = 'none'
			document.body.appendChild(a)
		}
		a.pause()
		a.onerror = () =>
			setAudioError(
				'Не удалось загрузить звук. Нужна прямая ссылка на MP3/OGG/WAV, а не страница сайта.',
			)
		a.src = el.src || ''
		a.volume = Math.max(0, Math.min(1, el.volume ?? 1))
		a.loop = false
		a.currentTime = 0
		void a
			.play()
			.then(() => setAudioError(''))
			.catch(() =>
				setAudioError(
					'Не удалось воспроизвести. Проверь, что ссылка ведёт на аудиофайл.',
				),
			)
	}
	const timerFinished =
		el.type === 'timer' &&
		el.timerDirection === 'down' &&
		(el.duration || 0) > 0 &&
		(el.isRunning && el.startTime
			? Date.now() - serverClockLag.ms - el.startTime
			: el.elapsed || 0) >=
			(el.duration || 0) * 1000

	return (
		<div className='space-y-4'>
			<h2 className='text-sm font-semibold text-gray-400 uppercase tracking-wide'>
				Свойства: {el.type}
			</h2>
			<div className='grid grid-cols-2 gap-2'>
				<NumberField label='X' value={el.x} onChange={v => update({ x: v })} />
				<NumberField label='Y' value={el.y} onChange={v => update({ y: v })} />
				<NumberField
					label='Ширина'
					value={el.width}
					onChange={v => update({ width: v })}
				/>
				<NumberField
					label='Высота'
					value={el.height}
					onChange={v => update({ height: v })}
				/>
			</div>
			<div className='grid grid-cols-2 gap-2 items-end'>
				<NumberField
					label='Поворот (°)'
					value={el.rotation ?? 0}
					onChange={v => update({ rotation: ((v % 360) + 360) % 360 })}
				/>
				<button
					onClick={() => update({ rotation: 0 })}
					className='px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
				>
					⟲ Сброс
				</button>
			</div>
			<div className='flex gap-2'>
				<button
					onClick={() =>
						emit('element:reorder', { id: el.id, direction: 'up' })
					}
					className='flex-1 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
				>
					↑ Вперёд
				</button>
				<button
					onClick={() =>
						emit('element:reorder', { id: el.id, direction: 'down' })
					}
					className='flex-1 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
				>
					↓ Назад
				</button>
			</div>
			<div className='flex gap-2'>
				<button
					onClick={() =>
						emit('element:reorder', { id: el.id, direction: 'front' })
					}
					className='flex-1 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
				>
					⤒ На самый верх
				</button>
				<button
					onClick={() =>
						emit('element:reorder', { id: el.id, direction: 'back' })
					}
					className='flex-1 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
				>
					⤓ На самый низ
				</button>
			</div>
			<div className='grid grid-cols-2 gap-2'>
				<button
					onClick={() => update({ flipH: !el.flipH })}
					className={`px-2 py-1.5 text-xs rounded-lg transition-colors ${el.flipH ? 'bg-accent text-white' : 'bg-border hover:bg-gray-600'}`}
				>
					⇋ Отразить ↔
				</button>
				<button
					onClick={() => update({ flipV: !el.flipV })}
					className={`px-2 py-1.5 text-xs rounded-lg transition-colors ${el.flipV ? 'bg-accent text-white' : 'bg-border hover:bg-gray-600'}`}
				>
					⇅ Отразить ↕
				</button>
			</div>
			<button
				onClick={() =>
					emit('element:add', {
						...el,
						id: undefined,
						zIndex: undefined,
						locked: false,
						x: el.x + 30,
						y: el.y + 30,
					})
				}
				className='w-full px-3 py-2 bg-border hover:bg-gray-600 text-white text-sm rounded-lg'
			>
				⧉ Дублировать элемент
			</button>
			<div className='flex items-center justify-between gap-2'>
				<div>
					<label className='text-xs text-gray-500 block'>Замок</label>
					<p className='text-[10px] text-gray-600 leading-tight'>
						Защита от случайного перетаскивания
					</p>
				</div>
				<button
					onClick={() => update({ locked: !el.locked })}
					className={`w-9 h-5 rounded-full transition-colors shrink-0 relative ${el.locked ? 'bg-green-500' : 'bg-gray-600'}`}
				>
					<span
						className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
						style={{ left: el.locked ? 18 : 2 }}
					/>
				</button>
			</div>
			<div>
				<label className='text-xs text-gray-500 block mb-1'>
					Прозрачность: {Math.round((el.opacity ?? 1) * 100)}%
				</label>
				{(() => {
					// заливка заканчивается по центру кружка (кружок 14px) — не торчит на краях
					const pct = Math.round((el.opacity ?? 1) * 100)
					const frac = (pct / 100).toFixed(4)
					const edge = `calc(7px + (100% - 14px) * ${frac})`
					return (
						<input
							type='range'
							min={0}
							max={100}
							step={5}
							value={pct}
							onChange={e => update({ opacity: Number(e.target.value) / 100 })}
							className='w-full'
							style={{
								background: `linear-gradient(to right, rgb(var(--c-accent)) 0, rgb(var(--c-accent)) ${edge}, rgb(var(--c-border)) ${edge}, rgb(var(--c-border)) 100%)`,
							}}
						/>
					)
				})()}
				{Math.round((el.opacity ?? 1) * 100) === 0 && (
					<p className='text-[10px] text-gray-600 mt-1'>
						Элемент скрыт на стриме; в превью он еле заметен
					</p>
				)}
			</div>
			{el.type !== 'text' && (
				<div className='rounded-xl border border-border bg-bg p-3 space-y-2'>
					<div className='flex items-center justify-between'>
						<span className='text-xs font-semibold uppercase tracking-wide text-gray-400'>
							Фон
						</span>
						<button
							onClick={() => update({ bgColor: 'transparent', bgOpacity: 1 })}
							title='Убрать фон'
							className='px-2 py-1 text-[10px] rounded-md border border-border text-gray-400 hover:text-white hover:bg-border transition-colors'
						>
							Прозрачный
						</button>
					</div>
					<div className='flex gap-2'>
						<input
							type='color'
							value={
								el.bgColor &&
								el.bgColor !== 'transparent' &&
								/^#[0-9a-f]{6}$/i.test(el.bgColor)
									? el.bgColor
									: '#000000'
							}
							onChange={e => update({ bgColor: e.target.value })}
							className='w-10 h-9 shrink-0 rounded-lg border border-border bg-bg cursor-pointer'
						/>
						<input
							type='text'
							value={el.bgColor || 'transparent'}
							onChange={e =>
								update({
									bgColor: e.target.value.trim() || 'transparent',
								})
							}
							placeholder='#000000 или transparent'
							className='flex-1 min-w-0 px-2 py-1.5 bg-panel border border-border rounded-lg text-xs font-mono'
						/>
					</div>
					<div>
						<label className='text-xs text-gray-500 block mb-1'>
							Прозрачность фона: {Math.round((el.bgOpacity ?? 1) * 100)}%
						</label>
						<input
							type='range'
							min={0}
							max={100}
							step={5}
							value={Math.round((el.bgOpacity ?? 1) * 100)}
							onChange={e =>
								update({ bgOpacity: Number(e.target.value) / 100 })
							}
							disabled={!el.bgColor || el.bgColor === 'transparent'}
							className='w-full accent-accent disabled:opacity-40'
						/>
					</div>
					{(!el.bgColor || el.bgColor === 'transparent') && (
						<p className='text-[10px] text-gray-600'>
							Фон выключен — виден только сам элемент.
						</p>
					)}
				</div>
			)}
			{el.type === 'text' && (
				<TextStyleControls key={el.id} el={el} update={update} />
			)}
			{el.type === 'timer' && (
				<>
					<div>
						<label className='text-xs text-gray-500 block mb-1'>
							Направление
						</label>
						<select
							value={el.timerDirection || 'down'}
							onChange={e =>
								update({ timerDirection: e.target.value as 'up' | 'down' })
							}
							className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
						>
							<option value='down'>Обратный отсчёт</option>
							<option value='up'>Прямой отсчёт</option>
						</select>
					</div>
					{el.timerDirection === 'down' && (
						<div className='grid grid-cols-3 gap-2'>
							<NumberField
								label='Часы'
								min={0}
								value={Math.floor((el.duration || 0) / 3600)}
								onChange={v =>
									update({
										duration: v * 3600 + ((el.duration || 0) % 3600),
									})
								}
							/>
							<NumberField
								label='Минуты'
								min={0}
								value={Math.floor(((el.duration || 0) % 3600) / 60)}
								onChange={v =>
									update({
										duration:
											Math.floor((el.duration || 0) / 3600) * 3600 +
											v * 60 +
											((el.duration || 0) % 60),
									})
								}
							/>
							<NumberField
								label='Секунды'
								min={0}
								value={(el.duration || 0) % 60}
								onChange={v =>
									update({
										duration: Math.floor((el.duration || 0) / 60) * 60 + v,
									})
								}
							/>
						</div>
					)}
					<div>
						<label className='text-xs text-gray-500 block mb-1'>Подпись</label>
						<input
							type='text'
							value={el.timerLabel || ''}
							onChange={e => update({ timerLabel: e.target.value })}
							placeholder='Таймер'
							className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
						/>
					</div>
					<div className='grid grid-cols-2 gap-2'>
						<div>
							<label className='text-xs text-gray-500 block mb-1'>Цвет</label>
							<input
								type='color'
								value={el.color || '#ffffff'}
								onChange={e => update({ color: e.target.value })}
								className='w-full h-9 rounded-lg border border-border bg-bg cursor-pointer'
							/>
						</div>
						<NumberField
							label='Шрифт'
							value={el.fontSize || 40}
							onChange={v => update({ fontSize: v })}
						/>
					</div>
					<div className='flex gap-2 pt-2'>
						{!el.isRunning || timerFinished ? (
							<button
								onClick={() => emit('timer:start', { id: el.id })}
								className='flex-1 px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg'
							>
								▶ Старт
							</button>
						) : (
							<button
								onClick={() => emit('timer:pause', { id: el.id })}
								className='flex-1 px-3 py-2 bg-yellow-700 hover:bg-yellow-600 text-white text-sm rounded-lg'
							>
								⏸ Пауза
							</button>
						)}
						<button
							onClick={() => emit('timer:reset', { id: el.id })}
							className='flex-1 px-3 py-2 bg-border hover:bg-gray-600 text-white text-sm rounded-lg'
						>
							⏹ Сброс
						</button>
					</div>
					{timerFinished && (
						<p className='text-[10px] text-gray-500'>
							Отсчёт завершён — «Старт» запустит его заново с самого начала.
						</p>
					)}
					{/* Звук окончания: свой файл с ПК вместо встроенного сигнала.
					    После выбора — громкость и длительность (не больше 10 секунд) */}
					<TimerSoundControls key={el.id} el={el} update={update} />
				</>
			)}
			{el.type === 'audio' && (
				<div className='space-y-3'>
					<button
						onClick={() =>
							emit('element:command', {
								id: el.id,
								cmd: 'audio-play',
							})
						}
						className='w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-sm rounded-lg'
					>
						<Play size={14} />
						Проиграть на стриме
					</button>
					<div className='grid grid-cols-2 gap-2'>
						<button
							onClick={() => {
								const a = localAudioRef.current
								if (a) {
									a.pause()
									a.currentTime = 0
								}
								emit('element:command', {
									id: el.id,
									cmd: 'audio-stop',
								})
							}}
							className='flex items-center justify-center gap-1.5 px-3 py-2 bg-border hover:bg-gray-600 text-white text-sm rounded-lg'
						>
							<Square size={13} />
							Остановить
						</button>
						<button
							onClick={previewAudio}
							title='Прослушать здесь, только в панели'
							aria-label='Прослушать в панели'
							className='flex items-center justify-center gap-1.5 px-3 py-2 bg-bg border border-border hover:bg-border text-gray-200 text-sm rounded-lg'
						>
							<Volume2 size={15} />
							Прослушать здесь
						</button>
					</div>
					<div>
						<label className='text-xs text-gray-500 block mb-1'>
							Громкость: {Math.round((el.volume ?? 1) * 100)}%
						</label>
						<input
							type='range'
							min={0}
							max={100}
							step={1}
							value={Math.round((el.volume ?? 1) * 100)}
							onChange={e => update({ volume: Number(e.target.value) / 100 })}
							className='w-full accent-accent'
						/>
					</div>
					<button
						onClick={() => update({ loop: !el.loop })}
						className='w-full flex items-center justify-between px-3 py-2 bg-bg border border-border rounded-lg text-sm'
					>
						<span>Повторять</span>
						<span
							className={`w-9 h-5 rounded-full relative shrink-0 ${el.loop ? 'bg-green-500' : 'bg-gray-600'}`}
						>
							<span
								className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
								style={{ left: el.loop ? 18 : 2 }}
							/>
						</span>
					</button>
					<p className='text-[10px] leading-relaxed text-gray-500'>
						Источник:{' '}
						<span className='break-all'>
							{el.src?.startsWith('data:') ? 'файл с ПК' : el.src || '—'}
						</span>
					</p>
					<p className='text-[10px] leading-relaxed text-gray-500'>
						На оверлее звук не рисуется. «Проиграть на стриме» уходит в OBS,
						«Прослушать здесь» слышно только в панели.
					</p>
					{audioError && (
						<p className='text-[11px] leading-relaxed text-red-400'>
							{audioError}
						</p>
					)}
				</div>
			)}
			{el.type === 'iframe' &&
				Array.isArray(el.playlist) &&
				el.playlist.length > 0 &&
				(() => {
					const list = el.playlist || []
					const idx = Math.min(
						Math.max(0, el.playlistIndex ?? 0),
						Math.max(0, list.length - 1),
					)
					const step = (dir: number) =>
						emit('playlist:step', { id: el.id, dir, expected: idx })
					return (
						<div className='space-y-2 rounded-lg border border-border bg-bg p-3'>
							<div className='flex items-center justify-between text-xs'>
								<span className='font-medium text-gray-300'>
									YouTube плейлист
								</span>
								<span className='text-gray-500'>
									{idx + 1} / {list.length}
								</span>
							</div>
							<div className='flex gap-2'>
								<button
									onClick={() => step(-1)}
									className='flex-1 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
								>
									← Предыдущее
								</button>
								<button
									onClick={() => step(1)}
									className='flex-1 px-2 py-1.5 text-xs bg-border hover:bg-gray-600 rounded-lg'
								>
									Следующее →
								</button>
							</div>
							<button
								onClick={() => update({ playlistLoop: !el.playlistLoop })}
								className='w-full flex items-center justify-between px-3 py-2 bg-panel border border-border rounded-lg text-sm'
							>
								<span>Повторять после последнего</span>
								<span
									className={`w-9 h-5 rounded-full relative shrink-0 ${el.playlistLoop ? 'bg-green-500' : 'bg-gray-600'}`}
								>
									<span
										className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
										style={{ left: el.playlistLoop ? 18 : 2 }}
									/>
								</span>
							</button>
							<p className='text-[10px] leading-relaxed text-gray-500'>
								Когда ролик заканчивается, автоматически включается следующий.
							</p>
						</div>
					)
				})()}
			{el.type === 'widget' && el.widget && (
				<div className='space-y-3'>
					<div className='rounded-lg border border-border bg-bg p-3'>
						<p className='text-[10px] uppercase tracking-wide text-gray-600'>
							Виджеты
						</p>
						<p className='mt-0.5 text-sm font-semibold'>{el.widget.name}</p>
						<button
							onClick={() => {
								if (!el.widget) return
								onEditWidget(el.widget)
							}}
							className='mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
						>
							<Pencil size={14} />
							Редактировать виджет
						</button>
						<p className='mt-1.5 text-[10px] leading-relaxed text-gray-500'>
							Откроет код и переменные во вкладке «Виджет».
						</p>
					</div>
					{el.widget.variables.length === 0 && (
						<p className='text-[10px] text-gray-500'>
							У этого виджета нет переменных.
						</p>
					)}
					{el.widget.variables.map(v => (
						<WidgetVariableControl
							key={v.name}
							variable={v}
							value={el.widgetValues?.[v.name] ?? v.value ?? ''}
							onChange={value =>
								update({
									widgetValues: {
										...(el.widgetValues || {}),
										[v.name]: value,
									},
								})
							}
							onTrigger={() =>
								emit('widget:trigger', {
									id: el.id,
									name: v.name,
									value: v.value,
								})
							}
						/>
					))}
				</div>
			)}
			{(el.type === 'image' ||
				el.type === 'video' ||
				el.type === 'audio' ||
				el.type === 'gif' ||
				el.type === 'iframe') && (
				<div>
					<label className='text-xs text-gray-500 block mb-1'>
						Источник (URL)
					</label>
					{el.type === 'iframe' && (
						<p className='text-xs text-gray-600 mb-1'>
							YouTube-ссылки автоматически конвертируются в embed
						</p>
					)}
					<input
						type='text'
						value={el.src?.startsWith('data:') ? '(файл с ПК)' : el.src || ''}
						onChange={e => update({ src: e.target.value })}
						placeholder='https://...'
						className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
					/>
				</div>
			)}
		</div>
	)
}
