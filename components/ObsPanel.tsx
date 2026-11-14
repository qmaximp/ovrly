'use client'

// OBS-пульт внутри панели.
//
// Стример: страница сама находит OBS на 127.0.0.1:4455, подключается и отдаёт
// состояние модераторам. Модератор: открывает эту же вкладку и управляет тем же
// OBS — команды идут через сервер, доступ проверяется по комнате.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { io as ioInit } from 'socket.io-client'

type Cmd =
	| { action: 'scene.set'; scene: string; id?: number }
	| { action: 'item.visible'; scene: string; sceneItemId: number; visible: boolean; id?: number }
	| { action: 'item.locked'; scene: string; sceneItemId: number; locked: boolean; id?: number }
	| { action: 'item.order'; scene: string; sceneItemId: number; index: number; id?: number }
	| { action: 'input.mute'; input: string; muted: boolean; id?: number }
	| { action: 'input.volume'; input: string; db: number; id?: number }

type Item = {
	id: number
	name: string
	kind: string
	visible: boolean
	locked: boolean
	isGroup: boolean
	/** сцена или группа, внутри которой лежит элемент — её и передаём в OBS */
	scene: string
	depth: number
	parentVisible: boolean
}

type Input = {
	name: string
	kind: string
	muted: boolean
	db: number
	/** источник активен в текущей сцене (с учётом групп) */
	active: boolean
}

type Snapshot = {
	obsVersion: string
	wsVersion: string
	currentScene: string
	scenes: { name: string; index: number }[]
	items: Item[]
	inputs: Input[]
	outputs: { streaming: boolean; recording: boolean; streamTime: number; recTime: number }
	at: number
}

type Phase = 'idle' | 'connecting' | 'on' | 'needpass' | 'error' | 'off'

const LS_KEY = 'obs.conn.v1'
const LS_ACTIVE = 'obs.onlyActive.v1'
// режим микшера: вертикальные каналы (как в OBS) или горизонтальные дорожки
const LS_MIXER = 'obs.mixer.v1'
// ширины колонок пульта (сцены / микшер) — сохраняются между сессиями
// общая высота панелей (сцены / источники / звук)
// локальный порядок сцен: OBS не умеет их переставлять через API
const LS_SCENE_ORDER = 'obs.sceneOrder.v1'
// раскладка пульта: порядок панелей, их ширина и высота
const LS_PANE_ORDER = 'obs.panes.order.v1'
const LS_PANE_SIZE = 'obs.panes.size.v1'
// свободное расположение панелей пульта: x, y, ширина, высота
const LS_PANE_GEO = 'obs.panes.geo.v1'
// выключатель моста: '0' — не подключаться к OBS вообще (переживает перезагрузку)
const LS_ENABLED = 'obs.enabled.v1'
const OBS_URL = 'ws://127.0.0.1:4455'

function pct(db: number) {
	if (!Number.isFinite(db)) return 0
	return Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
}

function fmtTime(ms: number) {
	const s = Math.floor((ms || 0) / 1000)
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const ss = String(s % 60).padStart(2, '0')
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// Список элементов сцены вместе с содержимым групп: OBS отдаёт группы отдельным
// запросом, поэтому верхний уровень и детей собираем рекурсивно.
async function loadTree(
	obs: any,
	name: string,
	depth = 0,
	parentVisible = true,
	parentIsGroup = false,
): Promise<Item[]> {
	const req = parentIsGroup ? 'GetGroupSceneItemList' : 'GetSceneItemList'
	let rows: any[] = []
	try {
		const r = await obs.call(req, { sceneName: name })
		rows = (r.sceneItems as any[]) || []
	} catch {
		return []
	}
	const out: Item[] = []
	for (const it of [...rows].reverse()) {
		const node: Item = {
			id: it.sceneItemId as number,
			name: it.sourceName as string,
			kind: (it.inputKind || it.sourceKind || '') as string,
			visible: !!it.sceneItemEnabled,
			locked: !!it.sceneItemLocked,
			isGroup: !!it.isGroup,
			scene: name,
			depth,
			parentVisible,
		}
		out.push(node)
		if (node.isGroup) {
			out.push(...(await loadTree(obs, node.name, depth + 1, parentVisible && node.visible, true)))
		}
	}
	return out
}

async function takeSnapshot(obs: any): Promise<Snapshot> {
	const [ver, list, stream, rec] = await Promise.all([
		obs.call('GetVersion'),
		obs.call('GetSceneList'),
		obs.call('GetStreamStatus').catch(() => null),
		obs.call('GetRecordStatus').catch(() => null),
	])
	const currentScene = list.currentProgramSceneName as string
	const scenes = ((list.scenes as any[]) || [])
		.map(s => ({ name: s.sceneName as string, index: s.sceneIndex as number }))
		.reverse()

	const items = await loadTree(obs, currentScene)
	const active = new Set(
		items.filter(it => it.visible && it.parentVisible).map(it => it.name),
	)

	let inputs: Input[] = []
	try {
		const r = await obs.call('GetInputList')
		const rows = await Promise.all(
			((r.inputs as any[]) || []).map(async i => {
				try {
					const m = await obs.call('GetInputMute', { inputName: i.inputName })
					const v = await obs.call('GetInputVolume', { inputName: i.inputName })
					return {
						name: i.inputName as string,
						kind: (i.inputKind || '') as string,
						muted: !!m.inputMuted,
						db: Number(v.inputVolumeDb ?? 0),
						active: active.has(i.inputName),
					}
				} catch {
					// не звуковой вход — в микшере ему не место
					return null
				}
			}),
		)
		inputs = rows.filter(Boolean) as Input[]
	} catch {}

	return {
		obsVersion: ver.obsVersion,
		wsVersion: ver.obsWebSocketVersion,
		currentScene,
		scenes,
		items,
		inputs,
		outputs: {
			streaming: !!stream?.outputActive,
			recording: !!rec?.outputActive,
			streamTime: Number(stream?.outputDuration || 0),
			recTime: Number(rec?.outputDuration || 0),
		},
		at: Date.now(),
	}
}

async function execCmd(obs: any, c: Cmd) {
	if (c.action === 'scene.set') return obs.call('SetCurrentProgramScene', { sceneName: c.scene })
	if (c.action === 'item.visible')
		return obs.call('SetSceneItemEnabled', {
			sceneName: c.scene,
			sceneItemId: c.sceneItemId,
			sceneItemEnabled: c.visible,
		})
	if (c.action === 'item.locked')
		return obs.call('SetSceneItemLocked', {
			sceneName: c.scene,
			sceneItemId: c.sceneItemId,
			sceneItemLocked: c.locked,
		})
	if (c.action === 'item.order')
		return obs.call('SetSceneItemIndex', {
			sceneName: c.scene,
			sceneItemId: c.sceneItemId,
			sceneItemIndex: c.index,
		})
	if (c.action === 'input.mute')
		return obs.call('SetInputMute', { inputName: c.input, inputMuted: c.muted })
	return obs.call('SetInputVolume', { inputName: c.input, inputVolumeDb: c.db })
}

// мгновенная реакция интерфейса: не ждём, пока OBS пришлёт новое состояние
function optimistic(s: Snapshot | null, c: Cmd): Snapshot | null {
	if (!s) return s
	if (c.action === 'scene.set')
		return { ...s, currentScene: c.scene }
	if (c.action === 'input.mute')
		return { ...s, inputs: s.inputs.map(i => (i.name === c.input ? { ...i, muted: c.muted } : i)) }
	if (c.action === 'input.volume')
		return { ...s, inputs: s.inputs.map(i => (i.name === c.input ? { ...i, db: c.db } : i)) }
	if (c.action === 'item.visible')
		return {
			...s,
			items: s.items.map(i => (i.id === c.sceneItemId && i.scene === c.scene ? { ...i, visible: c.visible } : i)),
		}
	if (c.action === 'item.locked')
		return {
			...s,
			items: s.items.map(i => (i.id === c.sceneItemId && i.scene === c.scene ? { ...i, locked: c.locked } : i)),
		}
	return s
}

function Eye({ on }: { on: boolean }) {
	return (
		<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
			{on ? (
				<>
					<path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z' />
					<circle cx='12' cy='12' r='3' />
				</>
			) : (
				<>
					<path d='M3 3l18 18' />
					<path d='M10.6 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4' />
					<path d='M6.2 6.4A17.9 17.9 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.2-.8' />
				</>
			)}
		</svg>
	)
}

function Lock({ on }: { on: boolean }) {
	return (
		<svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4'>
			<rect x='4' y='11' width='16' height='10' rx='2' />
			{on ? (
				<path d='M8 11V7a4 4 0 0 1 8 0v4' />
			) : (
				<path d='M8 11V7a4 4 0 0 1 7.4-2.1' />
			)}
		</svg>
	)
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			width='10'
			height='10'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='3'
			className={`transition-transform ${open ? 'rotate-90' : ''}`}
		>
			<path d='M9 6l6 6-6 6' />
		</svg>
	)
}

function Folder() {
	return (
		<svg
			width='13'
			height='13'
			viewBox='0 0 16 16'
			fill='currentColor'
			className='shrink-0 opacity-45'
		>
			<path d='M1.5 3.5A1.5 1.5 0 0 1 3 2h3.1l1.4 1.6H13A1.5 1.5 0 0 1 14.5 5.1v6.4A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-8Z' />
		</svg>
	)
}

function Speaker({ muted }: { muted: boolean }) {
	return (
		<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
			<path d='M4 9v6h4l5 4V5L8 9H4Z' />
			{muted ? <path d='M17 9l4 6M21 9l-4 6' /> : <path d='M17 8a5 5 0 0 1 0 8' />}
		</svg>
	)
}

// Вертикальный фейдер микшера: тянем мышью, как в OBS. Значения −60…+6 дБ,
// шаг 0.5; на отпускании отправляем команду в OBS.
function VerticalFader({
	value,
	disabled,
	onChange,
	onCommit,
}: {
	value: number
	disabled?: boolean
	onChange: (v: number) => void
	onCommit: (v: number) => void
}) {
	const box = useRef<HTMLDivElement | null>(null)
	const last = useRef(value)
	const active = useRef(false)
	const MIN = -60
	const MAX = 0
	const clamped = Math.max(MIN, Math.min(MAX, value))
	const pos = ((clamped - MIN) / (MAX - MIN)) * 100

	const apply = (clientY: number) => {
		const el = box.current
		if (!el) return
		const r = el.getBoundingClientRect()
		const t = 1 - (clientY - r.top) / r.height
		const raw = MIN + (MAX - MIN) * Math.max(0, Math.min(1, t))
		const v = Math.round(raw * 2) / 2
		last.current = v
		onChange(v)
	}

	return (
		<div
			ref={box}
			className={`relative h-full w-5 touch-none select-none ${
				disabled ? 'opacity-40' : 'cursor-ns-resize'
			}`}
			onPointerDown={e => {
				if (disabled) return
				e.preventDefault()
				active.current = true
				;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
				apply(e.clientY)
			}}
			onPointerMove={e => {
				// реагируем только на своё нажатие: иначе перетаскивание
				// ручки панели над фейдером меняло бы громкость
				if (disabled || !active.current) return
				apply(e.clientY)
			}}
			onPointerUp={e => {
				if (disabled || !active.current) return
				active.current = false
				apply(e.clientY)
				onCommit(last.current)
			}}
			onPointerCancel={() => {
				active.current = false
			}}
		>
			{/* жёлоб фейдера: тонкая линия поверх зелёного уровня, ползунок по центру */}
			<div className='pointer-events-none absolute inset-y-2 left-1/2 w-[4px] -translate-x-1/2 rounded-full bg-white/12'>
				<div
					className='absolute inset-x-0 bottom-0 rounded-full bg-emerald-400/60'
					style={{ height: `${pos}%` }}
				/>
				{/* ползунок ходит в области, где он целиком помещается */}
				<div className='absolute inset-x-0 bottom-[6px] top-[6px]'>
					<div
						className='absolute left-1/2 h-[12px] w-[18px] -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.55)] ring-1 ring-black/25'
						style={{ bottom: `${pos}%` }}
					/>
				</div>
			</div>
		</div>
	)
}


export default function ObsPanel({
	room,
	isStreamer,
	onAccessRevoked,
	onAccessGranted,
}: {
	room?: string | null
	isStreamer: boolean
	// право отозвали/вернули в кабинете — панель реагирует без перезагрузки
	onAccessRevoked?: () => void
	onAccessGranted?: () => void
}) {
	const [snap, setSnap] = useState<Snapshot | null>(null)
	const [levels, setLevels] = useState<Record<string, number>>({})
	const [phase, setPhase] = useState<Phase>('idle')
	const [presence, setPresence] = useState(false)
	const [toast, setToast] = useState('')
	const [password, setPassword] = useState('')
	const [passError, setPassError] = useState('')
	const [showPass, setShowPass] = useState(false)
	const [onlyActive, setOnlyActive] = useState(true)
	const [mixerVertical, setMixerVertical] = useState(true)
	// null — ещё не прочитали настройку, true/false — состояние моста
	const [enabled, setEnabled] = useState<boolean | null>(null)
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

	const obsRef = useRef<any>(null)
	const sockRef = useRef<Socket | null>(null)
	const snapRef = useRef<Snapshot | null>(null)
	const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const meterAt = useRef(0)
	const phaseRef = useRef<Phase>('idle')
	const pwRef = useRef('')
	const connecting = useRef(false)
	const mounted = useRef(true)
	const enabledRef = useRef(true)
	const cmdId = useRef(0)

	useEffect(() => {
		phaseRef.current = phase
	}, [phase])

	useEffect(() => {
		enabledRef.current = enabled !== false
	}, [enabled])

	useEffect(() => {
		try {
			setOnlyActive(localStorage.getItem(LS_ACTIVE) !== '0')
			setMixerVertical(localStorage.getItem(LS_MIXER) !== '0')
			setEnabled(localStorage.getItem(LS_ENABLED) !== '0')
		} catch {
			setEnabled(true)
		}
	}, [])

	// выключил OBS в одной вкладке — гаснет во всех открытых вкладках панели
	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key === LS_ENABLED) setEnabled(e.newValue !== '0')
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [])

	// ---- сокет комнаты: стример = мост, остальные = управление ----
	const openSocket = useCallback(() => {
		if (!room || sockRef.current) return
		const socket = ioInit({
			transports: ['websocket', 'polling'],
			query: isStreamer ? { room, obsbridge: '1' } : { room, obscontrol: '1' },
		})
		sockRef.current = socket
		socket.on('obs:presence', (d: { online?: boolean }) => setPresence(!!d?.online))
		socket.on('obs:state', (d: Snapshot) => {
			if (!d || typeof d !== 'object') return
			snapRef.current = d
			setSnap(d)
		})
		socket.on('obs:meters', (d: Record<string, number>) => setLevels(d || {}))
		socket.on('obs:denied', () => {
			setToast('нет доступа к OBS этой комнаты')
			onAccessRevoked?.()
		})
		socket.on('obs:access', (d: { allowed?: boolean }) => {
			if (d?.allowed === false) {
				setPresence(false)
				setSnap(null)
				setLevels({})
				setToast('доступ к OBS отозван')
				onAccessRevoked?.()
			} else if (d?.allowed === true) {
				onAccessGranted?.()
			}
		})
		socket.on('obs:result', (d: { error?: string }) => {
			if (d?.error) setToast(String(d.error))
		})
		// мост: команды модераторов выполняем на этом ПК и сразу отдаём новое
		// состояние, чтобы пульт не ждал следующего события OBS
		socket.on('obs:cmd', (cmd: Cmd) => {
			const obs = obsRef.current
			if (!obs) {
				socket.emit('obs:result', {
					id: cmd?.id,
					ok: false,
					error: 'OBS не подключён',
				})
				return
			}
			execCmd(obs, cmd)
				.then(() => {
					socket.emit('obs:result', { id: cmd?.id, ok: true })
					pushNow()
				})
				.catch((e: any) => {
					const msg = String(e?.message || e)
					setToast(msg)
					socket.emit('obs:result', { id: cmd?.id, ok: false, error: msg })
					pushNow()
				})
		})
		socket.on('connect', () => {
			if (isStreamer) pushNow()
		})
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [room, isStreamer])

	useEffect(() => {
		if (!room) return
		if (!isStreamer) openSocket()
		return () => {
			sockRef.current?.disconnect()
			sockRef.current = null
		}
	}, [room, isStreamer, openSocket])

	// выключить/включить мост: выбор переживает перезагрузку панели
	const stopObs = useCallback(() => {
		try {
			localStorage.setItem(LS_ENABLED, '0')
		} catch {}
		setEnabled(false)
	}, [])
	const startObs = useCallback(() => {
		try {
			localStorage.setItem(LS_ENABLED, '1')
		} catch {}
		setEnabled(true)
	}, [])

	const emitSnapshot = useCallback((s: Snapshot) => {		snapRef.current = s
		setSnap(s)
		sockRef.current?.emit('obs:state', s)
	}, [])

	const pushNow = useCallback(() => {
		const obs = obsRef.current
		if (!obs || !isStreamer) return
		if (pushTimer.current) return
		pushTimer.current = setTimeout(async () => {
			pushTimer.current = null
			try {
				const s = await takeSnapshot(obs)
				if (!mounted.current) return
				emitSnapshot(s)
			} catch {}
		}, 150)
	}, [emitSnapshot, isStreamer])

	// ---- подключение к OBS: автоматически, с повтором ----
	const connectObs = useCallback(
		async (pw: string) => {
			if (obsRef.current || connecting.current) return
			connecting.current = true
			setPhase('connecting')
			setToast('')
			try {
				const { default: OBSWebSocket } = await import('obs-websocket-js')
				const obs = new OBSWebSocket()
				await obs.connect(OBS_URL, pw || undefined, {
					// All + «тяжёлые» подписки: метры звука приходят только с явным флагом
					eventSubscriptions: 0xfffff,
				})
				if (!mounted.current) {
					obs.disconnect()
					return
				}
				obsRef.current = obs
				pwRef.current = pw
				setPassword(pw)
				setPassError('')
				setShowPass(false)
				setPhase('on')
				try {
					localStorage.setItem(LS_KEY, JSON.stringify({ password: pw || '' }))
				} catch {}

				obs.on('ConnectionClosed', () => {
					obsRef.current = null
					sockRef.current?.disconnect()
					sockRef.current = null
					if (enabledRef.current === false) return
					setPhase('error')
					setPresence(false)
				})
				obs.on('CurrentProgramSceneChanged', pushNow)
				obs.on('SceneItemEnableStateChanged', pushNow)
				obs.on('SceneItemListReindexed', pushNow)
				obs.on('SceneCreated', pushNow)
				obs.on('SceneRemoved', pushNow)
				obs.on('SceneNameChanged', pushNow)
				obs.on('InputMuteStateChanged', pushNow)
				obs.on('InputVolumeChanged', pushNow)
				obs.on('InputCreated', pushNow)
				obs.on('InputRemoved', pushNow)
				obs.on('InputNameChanged', pushNow)
				obs.on('StreamStateChanged', pushNow)
				obs.on('RecordStateChanged', pushNow)
				obs.on('InputVolumeMeters', (d: any) => {
					const now = Date.now()
					if (now - meterAt.current < 100) return
					meterAt.current = now
					const next: Record<string, number> = {}
					for (const i of d.inputs || []) {
						const vals = (i.inputLevelsMul || [])
							.flat(2)
							.map(Number)
							.filter((n: number) => isFinite(n) && n > 0)
						next[i.inputName] = vals.length ? 20 * Math.log10(Math.max(...vals)) : -60
					}
					setLevels(next)
					sockRef.current?.emit('obs:meters', next)
				})

				emitSnapshot(await takeSnapshot(obs))
				openSocket()
			} catch (e: any) {
				const msg = String(e?.message || e)
				// ошибку не логируем в консоль: Next в dev рисует поверх страницы
				// красный оверлей, из-за него пульт кажется сломанным
				if (/auth|password|identif/i.test(msg)) {
					setPhase('needpass')
					if (pw) setPassError('пароль не подошёл')
				} else {
					setPhase('error')
				}
			} finally {
				connecting.current = false
			}
		},
		[emitSnapshot, openSocket, pushNow],
	)

	useEffect(() => {
		mounted.current = true
		if (!isStreamer) return
		// настройки ещё читаются — не трогаем OBS
		if (enabled === null) return
		if (!enabled) {
			setPhase('off')
			setPresence(false)
			setSnap(null)
			setLevels({})
			return
		}
		let saved = ''
		try {
			saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}').password || ''
		} catch {}
		pwRef.current = saved
		connectObs(saved)
		const iv = setInterval(() => {
			if (obsRef.current || connecting.current || phaseRef.current === 'needpass') return
			connectObs(pwRef.current)
		}, 8000)
		return () => {
			clearInterval(iv)
			mounted.current = false
			if (pushTimer.current) clearTimeout(pushTimer.current)
			obsRef.current?.disconnect?.()
			obsRef.current = null
			// без этого мост оставался «в сети» после выключения: OBS закрыт, а
			// сокет комнаты жив — модератор продолжал видеть пульт
			sockRef.current?.disconnect()
			sockRef.current = null
			setPresence(false)
		}
	}, [isStreamer, enabled, connectObs])

	// ---- команды: стример выполняет локально, модератор — через сервер ----
	const run = useCallback(
		async (cmd: Cmd) => {
			setToast('')
			setSnap(prev => optimistic(prev, cmd))
			if (isStreamer) {
				const obs = obsRef.current
				if (!obs) {
					setToast('OBS не подключён')
					return
				}
				try {
					await execCmd(obs, cmd)
					sockRef.current?.emit('obs:result', { id: cmd.id, ok: true })
					pushNow()
				} catch (e: any) {
					const msg = String(e?.message || e)
					setToast(msg)
					sockRef.current?.emit('obs:result', { id: cmd.id, ok: false, error: msg })
					pushNow()
				}
				return
			}
			const socket = sockRef.current
			if (!socket || !socket.connected) {
				setToast('нет связи с сервером')
				return
			}
			const id = ++cmdId.current
			socket.emit('obs:cmd', { ...cmd, id })
		},
		[isStreamer, pushNow],
	)

	const setScene = (scene: string) => {
		if (scene === snap?.currentScene) return
		run({ action: 'scene.set', scene })
	}
	const toggleItem = (it: Item) =>
		run({
			action: 'item.visible',
			scene: it.scene,
			sceneItemId: it.id,
			visible: !it.visible,
		})
	const toggleLock = (it: Item) =>
		run({
			action: 'item.locked',
			scene: it.scene,
			sceneItemId: it.id,
			locked: !it.locked,
		})

	// Перетаскивание источников: OBS нумерует элементы снизу вверх, а список
	// показываем сверху вниз — поэтому индекс считается от конца.
	const [dragItem, setDragItem] = useState<Item | null>(null)
	// линия вставки: куда именно встанет источник (над/под строкой)
	const [dropMark, setDropMark] = useState<{ key: string; before: boolean } | null>(null)
	const [dropEnd, setDropEnd] = useState(false)

	// ---- панели пульта: своя ширина/высота у каждой + свободный порядок ----
	type PaneKey = 'scenes' | 'sources' | 'audio'
	const PANE_KEYS: PaneKey[] = ['scenes', 'sources', 'audio']
	const PANE_MIN_W: Record<PaneKey, number> = { scenes: 150, sources: 230, audio: 250 }
	const PANE_DEF_W: Record<PaneKey, number> = { scenes: 190, sources: 0, audio: 330 }

	type Geo = { x: number; y: number; w: number; h: number }
	const [geo, setGeo] = useState<Record<string, Geo>>({})
	const geoRef = useRef<Record<string, Geo>>({})
	const deskRef = useRef<HTMLDivElement | null>(null)
	const setDesk = useCallback((el: HTMLDivElement | null) => {
		deskRef.current = el
	}, [])
	const [raised, setRaised] = useState<PaneKey | null>(null)

	// раскладка и размеры переживают перезагрузку
	const defaults = (W: number, H: number): Record<string, Geo> => {
		const gap = 6
		if (W < 760) {
			const h = Math.max(160, Math.round((H - gap * 2) / 3))
			return {
				scenes: { x: 0, y: 0, w: W, h },
				sources: { x: 0, y: h + gap, w: W, h },
				audio: { x: 0, y: (h + gap) * 2, w: W, h },
			}
		}
		const scenesW = 190
		const audioW = Math.min(360, Math.max(280, Math.round(W * 0.28)))
		const sourcesW = Math.max(230, W - scenesW - audioW - gap * 2)
		return {
			scenes: { x: 0, y: 0, w: scenesW, h: H },
			sources: { x: scenesW + gap, y: 0, w: sourcesW, h: H },
			audio: { x: scenesW + gap + sourcesW + gap, y: 0, w: audioW, h: H },
		}
	}

	const saveGeo = (next: Record<string, Geo>, persist: boolean) => {
		geoRef.current = next
		setGeo(next)
		if (!persist) return
		try {
			localStorage.setItem(LS_PANE_GEO, JSON.stringify(next))
		} catch {}
	}

	// Возвращаем раскладку пульта после перезагрузки: раньше геометрия
	// сохранялась, но никогда не читалась обратно.
	useEffect(() => {
		let saved: Record<string, unknown>
		try {
			saved = JSON.parse(localStorage.getItem(LS_PANE_GEO) || '{}')
		} catch {
			return
		}
		if (!saved || typeof saved !== 'object') return
		const next: Record<string, Geo> = {}
		for (const key of PANE_KEYS) {
			const v = saved[key] as Partial<Geo> | undefined
			if (!v) continue
			const x = Number(v.x)
			const y = Number(v.y)
			const w = Number(v.w)
			const h = Number(v.h)
			if (![x, y, w, h].every(Number.isFinite)) continue
			next[key] = {
				x: Math.max(0, Math.round(x)),
				y: Math.max(0, Math.round(y)),
				w: Math.max(PANE_MIN_W[key], Math.round(w)),
				h: Math.max(120, Math.round(h)),
			}
		}
		if (!Object.keys(next).length) return
		// старое сохранение делалось с зазором 8 px, а в макете 6: подтягиваем
		// соседние панели, иначе после перезагрузки остаётся кривой зазор
		const row = PANE_KEYS.filter(k => next[k])
			.slice()
			.sort((a, b) => next[a].x - next[b].x)
		const originalX = Object.fromEntries(row.map(k => [k, next[k].x]))
		let shift = 0
		for (let i = 1; i < row.length; i++) {
			const prev = next[row[i - 1]]
			const cur = next[row[i]]
			if (cur.y !== prev.y || cur.h !== prev.h) continue
			const gap = originalX[row[i]] - (originalX[row[i - 1]] + prev.w)
			if (gap === 8) shift += 2
			cur.x = originalX[row[i]] - shift
		}
		geoRef.current = next
		setGeo(next)
	}, [])

	// при первом же перетаскивании снимаем геометрию всех панелей и дальше живём
	// в свободном режиме: каждая панель — на своих координатах
	const seed = () => {
		const desk = deskRef.current
		if (!desk) return
		const box = desk.getBoundingClientRect()
		const next: Record<string, Geo> = {}
		for (const k of PANE_KEYS) {
			const el = desk.querySelector<HTMLElement>(`[data-pane="${k}"]`)
			if (!el) continue
			const r = el.getBoundingClientRect()
			next[k] = {
				x: Math.round(r.left - box.left),
				y: Math.round(r.top - box.top),
				w: Math.round(r.width),
				// при входе в свободный режим поджимаем высоту, иначе панель на весь
				// экран и её нельзя сдвинуть по вертикали
				h: Math.min(Math.round(r.height), Math.round(box.height * 0.62)),
			}
		}
		geoRef.current = next
		setGeo(next)
	}

	const paneStyle = (key: PaneKey): React.CSSProperties => {
		const g = geo[key]
		// пока геометрия не снята — обычная flex-раскладка по умолчанию
		if (!g) {
			if (key === 'scenes') return { flex: '0 0 190px' }
			if (key === 'audio') return { flex: '0 0 330px' }
			return { flex: '1 1 230px' }
		}
		return {
			left: g.x,
			top: g.y,
			width: g.w,
			height: g.h,
			zIndex: raised === key ? 30 : 1,
		}
	}


	// прилипание: край панели цепляется к краям соседей и рабочей области
	const SNAP = 10
	// обязательный зазор между панелями — вплотную не прилипаем
	const GAP = 6
	const snapVal = (v: number, targets: number[]) => {
		let best = v
		let dist = SNAP + 1
		for (const t of targets) {
			const d = Math.abs(v - t)
			if (d < dist) {
				dist = d
				best = t
			}
		}
		return best
	}
	const neighbours = (key: PaneKey) =>
		PANE_KEYS.filter(k => k !== key)
			.map(k => geoRef.current[k])
			.filter(Boolean)

	// вешаем drag-слушатели на окно и гарантированно снимаем их и по
	// pointercancel (тач/жест браузера), иначе move-обработчик утекал навсегда
	const trackPointer = (move: (ev: PointerEvent) => void, up: () => void) => {
		const end = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', end)
			window.removeEventListener('pointercancel', end)
			up()
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', end)
		window.addEventListener('pointercancel', end)
	}

	// ширина: тянем правый край панели
	const startPaneWidth = (key: PaneKey) => (e: React.PointerEvent) => {
		e.preventDefault()
		e.stopPropagation()
		const desk = deskRef.current
		if (!desk) return
		if (!geoRef.current[key]) seed()
		const g0 = geoRef.current[key]
		if (!g0) return
		const startX = e.clientX
		const startW = g0.w
		const maxW = desk.clientWidth - g0.x
		document.body.classList.add('obs-pane-dragging', 'obs-pane-col')
		const move = (ev: PointerEvent) => {
			let w = Math.min(maxW, Math.max(PANE_MIN_W[key], startW + ev.clientX - startX))
			// правый край цепляется к левому/правому краю соседей и к краю области
			const targets = [maxW, ...neighbours(key).map(o => o.x - GAP - g0.x), ...neighbours(key).map(o => o.x + o.w - g0.x)]
			w = Math.round(snapVal(w, targets))
			saveGeo({ ...geoRef.current, [key]: { ...geoRef.current[key], w } }, false)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			document.body.classList.remove('obs-pane-dragging', 'obs-pane-col')
			saveGeo(geoRef.current, true)
		}
		trackPointer(move, up)
	}

	// высота: тянем нижний край панели
	const startPaneHeight = (key: PaneKey) => (e: React.PointerEvent) => {
		e.preventDefault()
		e.stopPropagation()
		const desk = deskRef.current
		if (!desk) return
		if (!geoRef.current[key]) seed()
		const g0 = geoRef.current[key]
		if (!g0) return
		const startY = e.clientY
		const startH = g0.h
		const maxH = desk.clientHeight - g0.y
		document.body.classList.add('obs-pane-dragging', 'obs-pane-row')
		const move = (ev: PointerEvent) => {
			let h = Math.min(maxH, Math.max(140, startH + ev.clientY - startY))
			// низ панели цепляется к краям соседей и к низу области
			const ns = neighbours(key)
			const targets = [maxH, ...ns.map(o => o.y - GAP - g0.y), ...ns.map(o => o.y + o.h - g0.y)]
			h = Math.round(snapVal(h, targets))
			saveGeo({ ...geoRef.current, [key]: { ...geoRef.current[key], h } }, false)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			document.body.classList.remove('obs-pane-dragging', 'obs-pane-row')
			saveGeo(geoRef.current, true)
		}
		trackPointer(move, up)
	}

	// левая граница: тянем — правый край панели остаётся на месте
	const startPaneLeft = (key: PaneKey) => (e: React.PointerEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (!geoRef.current[key]) seed()
		const g0 = geoRef.current[key]
		if (!g0) return
		const sx = e.clientX
		const startX = g0.x
		const right = g0.x + g0.w
		const minW = PANE_MIN_W[key]
		document.body.classList.add('obs-pane-dragging', 'obs-pane-col')
		const move = (ev: PointerEvent) => {
			let nx = Math.min(right - minW, Math.max(0, startX + ev.clientX - sx))
			const ns = neighbours(key)
			nx = snapVal(nx, [0, ...ns.flatMap(o => [o.x + o.w + GAP, o.x])])
			nx = Math.min(right - minW, Math.max(0, nx))
			saveGeo({ ...geoRef.current, [key]: { ...g0, x: Math.round(nx), w: Math.round(right - nx) } }, false)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			document.body.classList.remove('obs-pane-dragging', 'obs-pane-col')
			saveGeo(geoRef.current, true)
		}
		trackPointer(move, up)
	}

	// верхняя граница: тянем — нижний край остаётся на месте
	const startPaneTop = (key: PaneKey) => (e: React.PointerEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (!geoRef.current[key]) seed()
		const g0 = geoRef.current[key]
		if (!g0) return
		const sy = e.clientY
		const startY = g0.y
		const bottom = g0.y + g0.h
		document.body.classList.add('obs-pane-dragging', 'obs-pane-row')
		const move = (ev: PointerEvent) => {
			let ny = Math.min(bottom - 140, Math.max(0, startY + ev.clientY - sy))
			const ns = neighbours(key)
			ny = snapVal(ny, [0, ...ns.flatMap(o => [o.y + o.h + GAP, o.y])])
			ny = Math.min(bottom - 140, Math.max(0, ny))
			saveGeo({ ...geoRef.current, [key]: { ...g0, y: Math.round(ny), h: Math.round(bottom - ny) } }, false)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			document.body.classList.remove('obs-pane-dragging', 'obs-pane-row')
			saveGeo(geoRef.current, true)
		}
		trackPointer(move, up)
	}

	// свободное перемещение: тянем за заголовок и ставим куда угодно
	const startPaneMove = (key: PaneKey) => (e: React.PointerEvent) => {
		if ((e.target as HTMLElement).closest('button, input, select, label')) return
		const desk = deskRef.current
		if (!desk) return
		if (!geoRef.current[key]) seed()
		const g0 = geoRef.current[key]
		if (!g0) return
		e.preventDefault()
		setRaised(key)
		const sx = e.clientX
		const sy = e.clientY
		const { x, y, w, h } = g0
		let moved = false
		const move = (ev: PointerEvent) => {
			const ns = neighbours(key)
			const maxX = desk.clientWidth - w
			const maxY = desk.clientHeight - h
			let nx = Math.max(0, Math.min(maxX, x + ev.clientX - sx))
			let ny = Math.max(0, Math.min(maxY, y + ev.clientY - sy))
			// прилипание к краям соседей: вплотную, вровень и к границам области
			const xs = [0, maxX, ...ns.flatMap(o => [o.x, o.x + o.w - w, o.x + o.w + GAP, o.x - w - GAP])]
			const ys = [0, maxY, ...ns.flatMap(o => [o.y, o.y + o.h - h, o.y + o.h + GAP, o.y - h - GAP])]
			nx = snapVal(nx, xs)
			ny = snapVal(ny, ys)
			if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) {
				moved = true
				document.body.classList.add('obs-pane-moving')
			}
			saveGeo({ ...geoRef.current, [key]: { ...geoRef.current[key], x: Math.round(nx), y: Math.round(ny) } }, false)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			document.body.classList.remove('obs-pane-moving')
			if (moved) saveGeo(geoRef.current, true)
		}
		trackPointer(move, up)
	}


	// сброс размера: двойной клик по ручке
	const resetPane = (key: PaneKey, dim: 'w' | 'h') => {
		const desk = deskRef.current
		const g = geoRef.current[key]
		if (!desk || !g) return
		const d = defaults(desk.clientWidth, desk.clientHeight)[key]
		const next = {
			...geoRef.current,
			[key]: { ...g, [dim]: dim === 'w' ? d.w : d.h },
		}
		saveGeo(next, true)
	}

	// ---- сцены: локальный порядок (OBS не даёт менять его через API) ----
	const [sceneOrder, setSceneOrder] = useState<string[]>([])
	const [dragScene, setDragScene] = useState<string | null>(null)
	const [sceneMark, setSceneMark] = useState<{ name: string; before: boolean } | null>(null)

	useEffect(() => {
		try {
			const raw = localStorage.getItem(`${LS_SCENE_ORDER}:${room || ''}`)
			if (raw) setSceneOrder(JSON.parse(raw) as string[])
		} catch {}
	}, [room])

	const orderedScenes = useMemo(() => {
		const list = snap?.scenes || []
		const pos = new Map(sceneOrder.map((n, i) => [n, i]))
		return [...list].sort(
			(a, b) =>
				(pos.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
					(pos.get(b.name) ?? Number.MAX_SAFE_INTEGER) || 0,
		)
	}, [snap?.scenes, sceneOrder])

	const moveScene = (from: string, to: string, before: boolean) => {
		const names = orderedScenes.map(s => s.name)
		const rest = names.filter(n => n !== from)
		const at = Math.max(0, rest.indexOf(to) + (before ? 0 : 1))
		const next = [...rest.slice(0, at), from, ...rest.slice(at)]
		setSceneOrder(next)
		try {
			localStorage.setItem(`${LS_SCENE_ORDER}:${room || ''}`, JSON.stringify(next))
		} catch {}
	}

	const moveItem = (from: Item, to: Item | null, before = true) => {
		if (!snap) return
		if (to && to.id === from.id && to.scene === from.scene) return
		const sibs = snap.items.filter(i => i.scene === from.scene)
		const ids = sibs.map(i => i.id)
		const rest = ids.filter(id => id !== from.id)
		let at = to ? rest.indexOf(to.id) + (before ? 0 : 1) : rest.length
		// цель не из этого контейнера (или это сам источник) — ничего не делаем
		if (to && at < 0) return
		if (at < 0) at = rest.length
		const index = rest.length - at
		// текущая позиция в той же системе счёта (0 — низ)
		const current = rest.length - ids.indexOf(from.id)
		if (index === current) return
		run({ action: 'item.order', scene: from.scene, sceneItemId: from.id, index })
	}
	const toggleMute = (i: Input) => run({ action: 'input.mute', input: i.name, muted: !i.muted })
	const setVolume = (input: string, db: number) => run({ action: 'input.volume', input, db })

	const toggleGroup = (name: string) =>
		setCollapsed(prev => {
			const next = new Set(prev)
			if (next.has(name)) next.delete(name)
			else next.add(name)
			return next
		})

	const setOnly = (v: boolean) => {
		setOnlyActive(v)
		try {
			localStorage.setItem(LS_ACTIVE, v ? '1' : '0')
		} catch {}
	}

	// видимые строки дерева: дети свёрнутых групп не рисуем
	const rows = useMemo(() => {
		if (!snap) return []
		const out: Item[] = []
		const parents: { name: string; depth: number }[] = []
		for (const it of snap.items) {
			while (parents.length && parents[parents.length - 1].depth >= it.depth) parents.pop()
			if (!parents.some(p => collapsed.has(p.name))) out.push(it)
			if (it.isGroup) parents.push({ name: it.name, depth: it.depth })
		}
		return out
	}, [snap, collapsed])

	const inputs = useMemo(() => {
		const list = snap?.inputs || []
		return onlyActive ? list.filter(i => i.active) : list
	}, [snap, onlyActive])

	const activeAudio = snap?.inputs.filter(i => i.active).length || 0
	const connected = phase === 'on'
	const disabled = isStreamer ? !connected : !presence

	// режим микшера переживает перезагрузку панели
	const setMixer = (v: boolean) => {
		setMixerVertical(v)
		try {
			localStorage.setItem(LS_MIXER, v ? '1' : '0')
		} catch {}
	}

	return (
		<div className='flex h-full min-h-0 flex-col gap-2 p-3 text-[13px]'>
			{/* статус */}
			<div className='flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card/60 px-3 py-1.5'>
				<span
					className={`h-2.5 w-2.5 rounded-full ${
						connected || (presence && !isStreamer)
							? 'bg-emerald-500'
							: phase === 'connecting'
								? 'bg-amber-400'
								: 'bg-gray-500'
					}`}
				/>
				<span className='font-medium'>
					{isStreamer
						? connected
							? `OBS ${snap?.obsVersion ?? ''}`
							: phase === 'connecting'
								? 'подключаюсь…'
								: phase === 'needpass'
									? 'нужен пароль OBS'
									: phase === 'off'
										? 'OBS отключён'
										: 'OBS не найден'
						: presence
							? 'OBS стримера'
							: 'стример офлайн'}
				</span>
				{snap?.currentScene && <span className='opacity-45'>· {snap.currentScene}</span>}
				{snap?.outputs.streaming && (
					<span className='rounded bg-red-500/20 px-1.5 py-0.5 text-[11px] text-red-300'>
						LIVE {fmtTime(snap.outputs.streamTime)}
					</span>
				)}
				{snap?.outputs.recording && (
					<span className='rounded bg-border/60 px-1.5 py-0.5 text-[11px]'>
						REC {fmtTime(snap.outputs.recTime)}
					</span>
				)}
				<span className='ml-auto flex items-center gap-2 text-[11px] opacity-45'>
					{isStreamer ? (
						<>
							{enabled !== false && (
								<>
									<button
										onClick={() => setShowPass(v => !v)}
										className='rounded px-1.5 py-0.5 hover:bg-border/50'
									>
										пароль
									</button>
									<button
										onClick={pushNow}
										className='rounded px-1.5 py-0.5 hover:bg-border/50'
									>
										обновить
									</button>
								</>
							)}
							<button
								onClick={enabled === false ? startObs : stopObs}
								className='rounded px-1.5 py-0.5 hover:bg-border/50'
							>
								{enabled === false ? 'подключить' : 'отключить'}
							</button>
						</>
					) : (
						<span>{presence ? 'управление доступно' : 'ждём стримера'}</span>
					)}
				</span>
			</div>

			{/* пароль OBS (по кнопке или когда OBS его требует) */}
			{isStreamer && enabled !== false && (showPass || phase === 'needpass') && (
				<div className='flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2'>
					<span className='text-[12px] opacity-60'>
						{phase === 'needpass' ? 'OBS требует пароль WebSocket' : 'пароль OBS WebSocket'}
					</span>
					<input
						type='password'
						value={password}
						onChange={e => setPassword(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter') connectObs(password)
						}}
						placeholder='пароль из OBS → Инструменты'
						className='min-w-[180px] flex-1 rounded border border-border bg-bg px-2 py-1 text-[13px]'
					/>
					<button
						onClick={() => connectObs(password)}
						className='rounded bg-accent px-3 py-1 text-white hover:bg-accent-hover'
					>
						Подключить
					</button>
					{passError && <span className='text-[12px] text-red-300'>{passError}</span>}
				</div>
			)}

			{phase === 'error' && isStreamer && (
				<p className='rounded-lg border border-border bg-card/30 px-3 py-1.5 text-[12px] opacity-55'>
					Запусти OBS и включи Инструменты → WebSocket Server Settings. Повторяю попытку каждые
					8 секунд.
				</p>
			)}

			{toast && (
				<div className='rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300'>
					{toast}
				</div>
			)}

			{!isStreamer && !presence && (
				<p className='rounded-lg border border-border bg-card/30 px-3 py-2 text-[12px] opacity-55'>
					OBS управляется, пока у стримера открыта панель. Как только он её откроет, пульт
					оживёт сам.
				</p>
			)}

			<div className={`obs-desk min-h-0 flex-1${Object.keys(geo).length ? ' obs-desk-free' : ''}`} ref={setDesk}>
				{/* сцены */}
				<section className={`obs-pane relative flex min-h-0 flex-col rounded-lg border border-border bg-panel`} data-col='scenes' data-pane='scenes' style={paneStyle('scenes')}>
					<div className='obs-pane-w obs-pane-wl' onPointerDown={startPaneLeft('scenes')} />
					<div className='obs-pane-h obs-pane-ht' onPointerDown={startPaneTop('scenes')} />
					<div
						className='obs-pane-h'
						onPointerDown={startPaneHeight('scenes')}
						onDoubleClick={() => resetPane('scenes', 'h')}
						title='Потяни, чтобы изменить высоту · двойной клик — на всю высоту'
					/>
					<div
						className='obs-pane-w'
						onPointerDown={startPaneWidth('scenes')}
						onDoubleClick={() => resetPane('scenes', 'w')}
						title='Потяни, чтобы изменить ширину'
					/>
					<h2
						onPointerDown={startPaneMove('scenes')}
						className='cursor-move select-none border-b border-border/60 px-2.5 py-1.5 text-[11px] uppercase tracking-wide opacity-45'
						title='Перетащи, чтобы поменять панели местами'
					>
						Сцены
					</h2>
					<div className='min-h-0 flex-1 overflow-auto p-1'>
						{orderedScenes.map(s => {
							const mark = sceneMark?.name === s.name ? sceneMark.before : null
							return (
								<button
									key={s.name}
									disabled={disabled}
									draggable={!disabled}
									onDragStart={e => {
										setDragScene(s.name)
										e.dataTransfer.effectAllowed = 'move'
									}}
									onDragEnd={() => {
										setDragScene(null)
										setSceneMark(null)
									}}
									onDragOver={e => {
										if (!dragScene) return
										e.preventDefault()
										const r = e.currentTarget.getBoundingClientRect()
										setSceneMark({
											name: s.name,
											before: e.clientY < r.top + r.height / 2,
										})
									}}
									onDragLeave={() =>
										setSceneMark(m => (m?.name === s.name ? null : m))
									}
									onDrop={e => {
										if (!dragScene) return
										e.preventDefault()
										moveScene(dragScene, s.name, sceneMark?.before ?? true)
										setDragScene(null)
										setSceneMark(null)
									}}
									onClick={() => setScene(s.name)}
									title={s.name}
									className={`relative mb-0.5 flex h-7 w-full items-center gap-2 rounded px-2 text-left transition-colors ${
										s.name === snap?.currentScene
											? 'bg-accent text-white'
											: 'hover:bg-white/5 disabled:opacity-50'
									} ${dragScene === s.name ? 'opacity-40' : ''}`}
								>
									{mark !== null && (
										<span
											className={`pointer-events-none absolute left-0 right-0 h-[2px] rounded bg-accent ${
												mark ? 'top-0' : 'bottom-0'
											}`}
										/>
									)}
									<span className='truncate'>{s.name}</span>
								</button>
							)
						})}
						{!snap && <p className='px-1 py-3 text-[12px] opacity-40'>нет данных</p>}
					</div>
				</section>

				{/* источники */}
				<section
					className={`obs-pane relative flex min-h-0 flex-col rounded-lg border border-border bg-panel`}
					data-col='sources'
					data-pane='sources'
					style={paneStyle('sources')}
				>
					<div className='obs-pane-w obs-pane-wl' onPointerDown={startPaneLeft('sources')} />
					<div className='obs-pane-h obs-pane-ht' onPointerDown={startPaneTop('sources')} />
					<div
						className='obs-pane-h'
						onPointerDown={startPaneHeight('sources')}
						onDoubleClick={() => resetPane('sources', 'h')}
						title='Потяни, чтобы изменить высоту · двойной клик — на всю высоту'
					/>
					<div
						className='obs-pane-w'
						onPointerDown={startPaneWidth('sources')}
						onDoubleClick={() => resetPane('sources', 'w')}
						title='Потяни, чтобы изменить ширину'
					/>
					<h2
						onPointerDown={startPaneMove('sources')}
						className='flex cursor-move select-none items-center justify-between border-b border-border/60 px-2.5 py-1.5 text-[11px] uppercase tracking-wide opacity-45'
						title='Перетащи, чтобы поменять панели местами'
					>
						<span>Источники · {snap?.currentScene || '—'}</span>
						<span className='normal-case opacity-70'>{snap?.items.length || 0}</span>
					</h2>
					<div className='min-h-0 flex-1 overflow-auto py-1'>
						{rows.map((it, idx) => {
							const on = it.visible && it.parentVisible
							const rowKey = `${idx}:${it.scene}:${it.id}`
							return (
								<div
									key={rowKey}
									draggable={!disabled}
									onDragStart={e => {
										e.dataTransfer.effectAllowed = 'move'
										e.dataTransfer.setData('text/plain', it.name)
										setDragItem(it)
									}}
									onDragEnd={() => {
										setDragItem(null)
										setDropMark(null)
										setDropEnd(false)
									}}
									onDragOver={e => {
										if (!dragItem || dragItem.scene !== it.scene) return
										e.preventDefault()
										e.dataTransfer.dropEffect = 'move'
										const r = e.currentTarget.getBoundingClientRect()
										setDropMark({
											key: rowKey,
											before: e.clientY < r.top + r.height / 2,
										})
										setDropEnd(false)
									}}
									onDragLeave={() =>
										setDropMark(m => (m?.key === rowKey ? null : m))
									}
									onDrop={e => {
										if (!dragItem || dragItem.scene !== it.scene) return
										e.preventDefault()
										moveItem(dragItem, it, dropMark?.before ?? true)
										setDragItem(null)
										setDropMark(null)
										setDropEnd(false)
									}}
									className='relative flex h-7 items-center gap-1.5 pr-1.5 hover:bg-white/5'
									style={{ paddingLeft: 6 + it.depth * 14 }}
								>
									{/* линия вставки, как в OBS: между какими источниками встанет */}
									{dropMark?.key === rowKey && dragItem && (
										<span
											className='pointer-events-none absolute left-0 right-0 h-[2px] rounded bg-accent'
											style={{
												top: dropMark.before ? -1 : 'calc(100% - 1px)',
											}}
										/>
									)}
									{it.isGroup ? (
										<>
											<button
												onClick={() => toggleGroup(it.name)}
												className='flex h-4 w-4 shrink-0 items-center justify-center opacity-60 hover:opacity-100'
												title={collapsed.has(it.name) ? 'развернуть' : 'свернуть'}
											>
												<Chevron open={!collapsed.has(it.name)} />
											</button>
											<Folder />
										</>
									) : (
										<span className='w-4 shrink-0' />
									)}
									<span
										className={`min-w-0 flex-1 truncate ${on ? '' : 'opacity-40'} ${
											it.isGroup ? 'font-medium' : ''
										}`}
										title={it.name}
									>
										{it.name}
									</span>
									<button
										onClick={() => toggleLock(it)}
										disabled={disabled}
										className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/10 ${
											it.locked ? 'opacity-80' : 'opacity-60'
										} disabled:opacity-25`}
										title={it.locked ? 'разблокировать' : 'заблокировать'}
									>
										<Lock on={it.locked} />
									</button>
									<button
										disabled={disabled}
										onClick={() => toggleItem(it)}
										title={on ? 'скрыть' : 'показать'}
										className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/10 ${
											on ? 'opacity-90' : 'opacity-35'
										} disabled:opacity-25`}
									>
										<Eye on={on} />
									</button>
								</div>
							)
						})}
						{/* невидимая зона «в самый низ»: показываем только линию вставки */}
						{dragItem && (
							<div
								onDragOver={e => {
									e.preventDefault()
									e.dataTransfer.dropEffect = 'move'
									setDropMark(null)
									setDropEnd(true)
								}}
								onDragLeave={() => setDropEnd(false)}
								onDrop={e => {
									e.preventDefault()
									moveItem(dragItem, null)
									setDragItem(null)
									setDropMark(null)
									setDropEnd(false)
								}}
								className='relative h-7'
							>
								{dropEnd && (
									<span className='pointer-events-none absolute left-0 right-0 top-0 h-[2px] rounded bg-accent' />
								)}
							</div>
						)}
						{snap && rows.length === 0 && (
							<p className='px-2 py-3 text-[12px] opacity-40'>сцена пуста</p>
						)}
						{!snap && <p className='px-2 py-3 text-[12px] opacity-40'>нет данных</p>}
					</div>
				</section>

				{/* звук */}
				<section
					className={`obs-audio obs-pane relative flex min-h-0 flex-col rounded-lg border border-border bg-panel`}
					data-col='audio'
					data-pane='audio'
					style={paneStyle('audio')}
				>
					<div className='obs-pane-w obs-pane-wl' onPointerDown={startPaneLeft('audio')} />
					<div className='obs-pane-h obs-pane-ht' onPointerDown={startPaneTop('audio')} />
					<div
						className='obs-pane-h'
						onPointerDown={startPaneHeight('audio')}
						onDoubleClick={() => resetPane('audio', 'h')}
						title='Потяни, чтобы изменить высоту · двойной клик — на всю высоту'
					/>
					<div
						className='obs-pane-w'
						onPointerDown={startPaneWidth('audio')}
						onDoubleClick={() => resetPane('audio', 'w')}
						title='Потяни, чтобы изменить ширину'
					/>
					<h2
						onPointerDown={startPaneMove('audio')}
						className='flex cursor-move select-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-2.5 py-1.5 text-[11px] uppercase tracking-wide opacity-45'
						title='Перетащи, чтобы поменять панели местами'
					>
						<span>Звук · {inputs.length}</span>
						<label className='flex cursor-pointer items-center gap-1.5 normal-case opacity-80'>
							<input
								type='checkbox'
								checked={onlyActive}
								onChange={e => setOnly(e.target.checked)}
								className='accent-accent'
							/>
							только активные
						</label>
						<label
							className='ml-auto flex cursor-pointer items-center gap-1.5 normal-case opacity-80'
							title='вертикальный микшер, как в OBS'
						>
							<input
								type='checkbox'
								checked={mixerVertical}
								onChange={e => setMixer(e.target.checked)}
								className='accent-accent'
							/>
							вертикально
						</label>
					</h2>

					{mixerVertical ? (
						/* вертикальный микшер: каналы столбиками, как в OBS */
						<div className='min-h-0 flex-1 overflow-auto p-2'>
							<div className='flex h-full min-h-[190px] gap-1.5'>
								{inputs.map(i => (
									<div
										key={i.name}
										className='flex h-full w-[74px] shrink-0 flex-col items-center gap-1 rounded-md border border-border/50 bg-bg/40 px-1 pb-1 pt-1.5'
									>
										<span
											className={`w-full truncate text-center text-[10px] leading-tight ${
												i.muted ? 'opacity-40' : 'opacity-75'
											}`}
											title={i.name}
										>
											{i.name}
										</span>
										<span className='text-[10px] tabular-nums opacity-45'>
											{i.muted ? '−∞' : `${i.db.toFixed(1)}`}
										</span>

										<div className='flex min-h-0 w-full flex-1 items-stretch justify-center gap-1.5'>
											{/* индикатор уровня */}
											<div className='relative w-[6px] overflow-hidden rounded-full bg-white/10'>
												<div
													className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 via-emerald-400 to-amber-300'
													style={{
														height: `${i.muted ? 0 : pct(levels[i.name] ?? -60)}%`,
													}}
												/>
											</div>
											{/* фейдер */}
											<VerticalFader
												value={i.db}
												disabled={disabled}
												onChange={v =>
													setSnap(prev =>
														prev
															? {
																	...prev,
																	inputs: prev.inputs.map(x =>
																		x.name === i.name ? { ...x, db: v } : x,
																	),
																}
															: prev,
													)
												}
												onCommit={v => setVolume(i.name, v)}
											/>
										</div>

										<button
											disabled={disabled}
											onClick={() => toggleMute(i)}
											title={i.muted ? 'включить звук' : 'заглушить'}
											className={`flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 ${
												i.muted ? 'text-red-400' : 'text-emerald-400'
											} disabled:opacity-30`}
										>
											<Speaker muted={i.muted} />
										</button>
									</div>
								))}
							</div>
							{snap && inputs.length === 0 && (
								<p className='px-1 py-3 text-[12px] opacity-40'>
									{onlyActive
										? `в этой сцене нет активного звука (всего ${activeAudio})`
										: 'нет звука'}
								</p>
							)}
							{!snap && <p className='px-1 py-3 text-[12px] opacity-40'>нет данных</p>}
						</div>
					) : (
						/* горизонтальный микшер: дорожки, как в OBS */
						<div className='min-h-0 flex-1 overflow-auto px-2 py-1'>
							{inputs.map(i => (
								<div key={i.name} className='py-1.5'>
									<div className='flex items-center gap-2'>
										<button
											disabled={disabled}
											onClick={() => toggleMute(i)}
											title={i.muted ? 'включить звук' : 'заглушить'}
											className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-white/10 ${
												i.muted ? 'text-red-400' : 'text-emerald-400'
											} disabled:opacity-30`}
										>
											<Speaker muted={i.muted} />
										</button>
										<span
											className={`min-w-0 flex-1 truncate text-[12px] ${
												i.muted ? 'opacity-45' : ''
											}`}
											title={i.name}
										>
											{i.name}
										</span>
										<span className='shrink-0 text-[11px] tabular-nums opacity-45'>
											{i.muted ? '−∞' : `${i.db.toFixed(1)} dB`}
										</span>
									</div>
									<input
										disabled={disabled}
										type='range'
										min={-60}
										max={0}
										step={1}
										value={Math.max(-60, Math.min(0, Math.round(i.db)))}
										onChange={e =>
											setSnap(prev =>
												prev
													? {
															...prev,
															inputs: prev.inputs.map(x =>
																x.name === i.name
																	? { ...x, db: Number(e.target.value) }
																	: x,
															),
														}
													: prev,
											)
										}
										onPointerUp={e =>
											setVolume(i.name, Number((e.target as HTMLInputElement).value))
										}
										onKeyUp={e =>
											setVolume(i.name, Number((e.target as HTMLInputElement).value))
										}
										className='mt-1 h-4 w-full accent-emerald-400 disabled:opacity-30'
									/>
									<div className='mt-0.5 h-[3px] overflow-hidden rounded-full bg-white/10'>
										<div
											className='h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-amber-300'
											style={{ width: `${i.muted ? 0 : pct(levels[i.name] ?? -60)}%` }}
										/>
									</div>
								</div>
							))}
							{snap && inputs.length === 0 && (
								<p className='px-1 py-3 text-[12px] opacity-40'>
									{onlyActive
										? `в этой сцене нет активного звука (всего ${activeAudio})`
										: 'нет звука'}
								</p>
							)}
							{!snap && <p className='px-1 py-3 text-[12px] opacity-40'>нет данных</p>}
						</div>
					)}
				</section>
			</div>
		</div>
	)
}
