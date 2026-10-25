'use client'

import type { StreamElement, SyncState } from '@/lib/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import WidgetFrame from '@/components/WidgetFrame'
import { toEmbedUrl } from '@/lib/embed'
import { parseMediaUrl, youtubeEmbedUrl, loadTwitchSdk } from '@/lib/media'
import { playTimerSound } from '@/lib/sound'
import { noteServerClock, serverClockLag } from '@/lib/clock'
import { colorWithOpacity } from '@/lib/color'
import { textBoxStyle, ensureFontLoaded } from '@/lib/textStyle'
import { io as ioInit } from 'socket.io-client'

// медиа-плееры оверлея: YouTube — iframe + postMessage, Twitch — SDK-плеер.
// Панель управляет ими командами element:command (плей/пауза/перемотка/звук/субтитры)
const ytFrames = new Map<string, HTMLIFrameElement>()
const twitchPlayers = new Map<string, any>()
const twitchSt = new Map<string, number>() // 1 играет / 2 пауза (из событий SDK)
const playerTimes = new Map<string, { t: number; st: number }>()
// цель позиции от панели + когда она обновлялась: дрейф-коррекция работает только
// по СВЕЖЕЙ цели (панель шлёт её 1/с для играющих элементов). Устаревшая цель
// (панель закрыта / видео остановлено в панели) отматывала бы плеер по кругу
const seekTargets = new Map<string, { t: number; at: number }>()
// элементы, у которых пользователь ОСОЗНАННО включил субтитры кнопкой в панели:
// для остальных YouTube-роликов субтитры принудительно выгружаются (см. ниже)
const ytCcOn = new Set<string>()
const FRESH_MS = 5000

// забываем всё, что оверлей держал про элемент: без этого карты плееров и позиций
// растут всю сессию и держат ссылки на удалённые элементы (особенно с base64-видео)
function forgetElement(id: string) {
	ytFrames.delete(id)
	twitchPlayers.delete(id)
	twitchSt.delete(id)
	playerTimes.delete(id)
	seekTargets.delete(id)
	ytCcOn.delete(id)
}

function forgetAllElements() {
	ytFrames.clear()
	twitchPlayers.clear()
	twitchSt.clear()
	playerTimes.clear()
	seekTargets.clear()
	ytCcOn.clear()
}

export default function OverlayClient({ room }: { room?: string | null }) {
	const [state, setState] = useState<SyncState>({
		elements: [],
		canvasW: 1920,
		canvasH: 1080,
	})
	// свежее состояние и сокет для обработчика сообщений YouTube (эффект ниже
	// монтируется один раз и не должен зависеть от пересоздания сокета)
	const stateRef = useRef(state)
	stateRef.current = state
	const socketRef = useRef<any>(null)
	const playlistStepAtRef = useRef<Map<string, number>>(new Map())
	const [, force] = useState(0)
	const [scale, setScale] = useState(1)
	// YouTube-элементы, которые реально заиграли: до этого поверх iframe своя
	// заставка (нативный постер YouTube с кнопками в стриме показывать нельзя)
	const [ytStarted, setYtStarted] = useState<Set<string>>(new Set())
	const markYtStarted = (id: string) =>
		setYtStarted(prev => {
			if (prev.has(id)) return prev
			const s = new Set(prev)
			s.add(id)
			return s
		})

	useEffect(() => {
		const socket = ioInit({ transports: ['websocket', 'polling'], query: { room: room || 'default' } })
		socketRef.current = socket
		socket.on('state:init', (s: SyncState) => setState(s))
		socket.on('element:added', (el: StreamElement) =>
			setState(p => ({ ...p, elements: [...p.elements, el] })),
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
			(d: { id: string; x?: number; y?: number; width: number; height: number }) =>
				setState(p => ({
					...p,
					elements: p.elements.map(e =>
						e.id === d.id ? { ...e, x: d.x ?? e.x, y: d.y ?? e.y, width: d.width, height: d.height } : e,
					),
				})),
		)
		socket.on('element:deleted', (id: string) => {
			forgetElement(id)
			setYtStarted(prev => {
				if (!prev.has(id)) return prev
				const s = new Set(prev)
				s.delete(id)
				return s
			})
			setState(p => ({ ...p, elements: p.elements.filter(e => e.id !== id) }))
		})
		socket.on('element:zorder', (ids: string[]) =>
			setState(p => {
				const z = new Map(ids.map((id, i) => [id, i]))
				return { ...p, elements: p.elements.map(e => ({ ...e, zIndex: z.get(e.id) ?? e.zIndex })) }
			}),
		)
		socket.on('elements:cleared', () => {
			forgetAllElements()
			setYtStarted(new Set())
			setState(p => ({ ...p, elements: [] }))
		})
		// кнопка виджета из панели: пробрасываем в sandboxed iframe
		socket.on('widget:trigger', (d: any) => {
			window.dispatchEvent(new CustomEvent('ovrly:widget-trigger', { detail: d }))
		})
		socket.on('widget:chat', (d: any) => {
			window.dispatchEvent(new CustomEvent('ovrly:widget-chat', { detail: d }))
		})
		socket.on('widget:twitch-event', (d: any) => {
			window.dispatchEvent(
				new CustomEvent('ovrly:widget-twitch-event', { detail: d }),
			)
		})
		// команды медиа-плееру из панели: YouTube — postMessage, Twitch — SDK
		socket.on('element:command', ({ id, cmd, value }: { id: string; cmd: string; value?: number }) => {
			const yf = ytFrames.get(id)
			if (yf?.contentWindow) {
				// handshake перед командой: команды до готовности API плеер молча игнорирует
				yf.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')
				const post = (func: string, args: any[] = []) =>
					yf.contentWindow!.postMessage(JSON.stringify({ event: 'command', func, args }), '*')
				if (cmd === 'play') post('playVideo')
				else if (cmd === 'pause') post('pauseVideo')
				else if (cmd === 'volume') post('setVolume', [value ?? 100])
				else if (cmd === 'mute') post('mute')
				else if (cmd === 'unmute') post('unMute')
				else if (cmd === 'cc') {
					if (value) ytCcOn.add(id)
					else ytCcOn.delete(id)
					post(value ? 'loadModule' : 'unloadModule', ['captions'])
				}
				else if (cmd === 'seek') {
					// целевая позиция из превью: подтягиваемся при расхождении > 2с —
					// даже на паузе; незапущенный плеер не трогаем (seek до старта его клинит)
					seekTargets.set(id, { t: value ?? 0, at: Date.now() })
					const cur = playerTimes.get(id)
					const started = !!cur && (cur.st === 1 || cur.st === 2 || cur.st === 3)
					if (started && cur && Math.abs(cur.t - (value ?? 0)) > 2) {
						post('seekTo', [value ?? 0, true])
						playerTimes.set(id, { t: value ?? 0, st: cur.st })
					}
				}
				// YouTube включает субтитры сам (по настройке зрителя или у видео с
				// принудительными субтитрами) — гасим после того, что это провоцирует
				if ((cmd === 'play' || cmd === 'pause' || cmd === 'seek') && !ytCcOn.has(id))
					post('unloadModule', ['captions'])
			}
			const tp = twitchPlayers.get(id)
			if (tp) {
				try {
					if (cmd === 'play') tp.play()
					else if (cmd === 'pause') tp.pause()
					else if (cmd === 'volume') tp.setVolume((value ?? 100) / 100)
					else if (cmd === 'mute') tp.mute?.()
					else if (cmd === 'unmute') tp.unmute?.()
					else if (cmd === 'seek') {
						seekTargets.set(id, { t: value ?? 0, at: Date.now() })
						const st = twitchSt.get(id)
						const cur = playerTimes.get(id)
						if (st === 1 && cur && Math.abs(cur.t - (value ?? 0)) > 2) tp.seek(value ?? 0)
					}
				} catch {}
			}
			// обычное видео (файл/прямая ссылка): управляем самим DOM-плеером оверлея.
			// Позицию панель для таких элементов не ретранслирует (seek слышен как
			// рывки) — сюда приходят только явные действия пользователя
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
			}
			// звуковой элемент (звуковая кнопка): на оверлее он не рисуется,
			// но живёт как <audio> и слушает команды из свойств панели
			const a = document.querySelector(
				`audio[data-id="${id}"]`,
			) as HTMLAudioElement | null
			if (a) {
				try {
					if (cmd === 'audio-play') {
						a.currentTime = 0
						void a.play().catch(() => {})
					} else if (cmd === 'audio-stop') {
						a.pause()
						a.currentTime = 0
					} else if (cmd === 'audio-pause') a.pause()
					else if (cmd === 'audio-volume') {
						a.volume = Math.max(0, Math.min(1, (value ?? 100) / 100))
					} else if (cmd === 'audio-loop') a.loop = !!value
				} catch {}
			}
		})
		// панель с выбранным играющим элементом отдаст play/seek/субтитры
		socket.on('connect', () => socket.emit('overlay:hello'))
		return () => {
			socketRef.current = null
			socket.disconnect()
		}
	}, [])

	// отчёты YouTube-плееров: позиция/состояние; при дрейфе от превью > 2с — перемотка
	useEffect(() => {
		const onMsg = (e: MessageEvent) => {
			let id: string | null = null
			for (const [key, f] of ytFrames) if (f.contentWindow === e.source) { id = key; break }
			if (!id) return
			try {
				const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
				// initialDelivery несёт duration/playerState, infoDelivery — позицию
				if (!d || (d.event !== 'infoDelivery' && d.event !== 'initialDelivery') || !d.info) return
				const t = d.info.currentTime ?? playerTimes.get(id)?.t
				const st = d.info.playerState ?? playerTimes.get(id)?.st ?? 0
				if (t !== undefined) playerTimes.set(id, { t, st })
				if (st === 1 || t > 0.5) markYtStarted(id)
				const target = seekTargets.get(id)
				if (
					t !== undefined && target !== undefined && st === 1 &&
					Date.now() - target.at < FRESH_MS && Math.abs(t - target.t) > 2
				) {
					ytFrames.get(id)?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [target.t, true] }), '*')
				}
				// ролик закончился — оверлей сам просит следующий: плейлист
				// продолжается, даже если панель закрыта. expected не даёт двум
				// клиентам (панель + оверлей) переключить дважды
				const el = stateRef.current.elements.find(x => x.id === id)
				if (st === 0 && el && Array.isArray(el.playlist) && el.playlist.length) {
					const now = Date.now()
					const last = playlistStepAtRef.current.get(id) || 0
					if (now - last > 1500) {
						playlistStepAtRef.current.set(id, now)
						socketRef.current?.emit('playlist:step', {
							id,
							dir: 1,
							expected: el.playlistIndex ?? 0,
						})
					}
				}
			} catch {}
		}
		window.addEventListener('message', onMsg)
		// handshake: без него YouTube не присылает infoDelivery.
		// Заодно держим субтитры выключенными (кроме элементов, где их включили кнопкой):
		// YouTube включает их сам, а в кадре они не нужны
		const hs = setInterval(() => {
			for (const [id, f] of ytFrames) {
				if (!f.contentWindow) continue
				f.contentWindow.postMessage(
					JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
					'*',
				)
				if (!ytCcOn.has(id))
					f.contentWindow.postMessage(
						JSON.stringify({ event: 'command', func: 'unloadModule', args: ['captions'] }),
						'*',
					)
			}
		}, 5000)
		return () => { window.removeEventListener('message', onMsg); clearInterval(hs) }
	}, [])

	// опрос Twitch-плееров: позиция для дрейф-коррекции
	useEffect(() => {
		const i = setInterval(() => {
			for (const [id, p] of twitchPlayers) {
				try {
					const t = p.getCurrentTime?.()
					if (typeof t !== 'number') continue
					const st = twitchSt.get(id) ?? 0
					playerTimes.set(id, { t, st })
					const target = seekTargets.get(id)
					if (
						st === 1 && target !== undefined &&
						Date.now() - target.at < FRESH_MS && Math.abs(t - target.t) > 2
					) p.seek(target.t)
				} catch {}
			}
		}, 1000)
		return () => clearInterval(i)
	}, [])

	// перерисовка нужна только пока идёт хотя бы один таймер
	const hasRunningTimer = state.elements.some(e => e.type === 'timer' && e.isRunning)
	useEffect(() => {
		if (!hasRunningTimer) return
		const i = setInterval(() => force(x => x + 1), 250)
		return () => clearInterval(i)
	}, [hasRunningTimer])

	useEffect(() => {
		const update = () => {
			const sw = window.innerWidth / state.canvasW
			const sh = window.innerHeight / state.canvasH
			setScale(Math.min(sw, sh))
		}
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	}, [state.canvasW, state.canvasH])

	const sorted = [...state.elements].sort(
		(a, b) => (a.zIndex || 0) - (b.zIndex || 0),
	)

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				overflow: 'hidden',
				background: 'transparent',
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					width: state.canvasW,
					height: state.canvasH,
					transform: `scale(${scale})`,
					transformOrigin: 'top left',
					overflow: 'hidden',
				}}
			>
				{sorted.map(el =>
					el.visible || el.alwaysLoaded ? (
						<OverlayElement key={el.id} el={el} ytStarted={ytStarted.has(el.id)} />
					) : null,
				)}
			</div>
		</div>
	)
}

function OverlayElement({ el, ytStarted }: { el: StreamElement; ytStarted: boolean }) {
	const [, force] = useState(0)
	const playedRef = useRef(false)
	// стабильный ref-колбэк: инлайн-колбэк менял бы идентичность на каждый рендер
	// и React снимал/ставил бы ref заново (лишняя работа на каждом кадре таймера)
	const setYtFrame = useCallback(
		(f: HTMLIFrameElement | null) => {
			if (f) ytFrames.set(el.id, f)
			else ytFrames.delete(el.id)
		},
		[el.id],
	)

	// веб-шрифт текста (Google) грузим по требованию: в OBS интернет нужен,
	// только если выбран не системный шрифт
	useEffect(() => {
		if (el.type === 'text') ensureFontLoaded(el.fontFamily)
	}, [el.type, el.fontFamily])

	useEffect(() => {
		if (el.type !== 'timer' || !el.isRunning) return
		const i = setInterval(() => force(x => x + 1), 100)
		return () => clearInterval(i)
	}, [el.type, el.isRunning])

	const style: React.CSSProperties = {
		position: 'absolute',
		left: el.x,
		top: el.y,
		width: el.width,
		height: el.height,
		zIndex: el.zIndex,
		visibility: el.visible ? 'visible' : 'hidden',
		opacity: el.opacity ?? 1,
		transform: `${el.rotation ? `rotate(${el.rotation}deg)` : ''}${el.flipH || el.flipV ? ` scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : ''}` || undefined,
		transformOrigin: 'center',
		background:
			el.type !== 'text' &&
			el.type !== 'timer' &&
			el.type !== 'widget' &&
			el.bgColor &&
			el.bgColor !== 'transparent'
				? colorWithOpacity(el.bgColor, el.bgOpacity ?? 1)
				: undefined,
	}

	if (el.type === 'widget' && el.widget)
		return (
			<div style={style}>
				<WidgetFrame
					widget={el.widget}
					values={el.widgetValues}
					isOverlay
					elementId={el.id}
					background={
						el.bgColor && el.bgColor !== 'transparent'
							? colorWithOpacity(el.bgColor, el.bgOpacity ?? 1)
							: undefined
					}
				/>
			</div>
		)
	if (el.type === 'image' || el.type === 'gif')
		return (
			<div style={style}>
				<img
					src={el.src}
					alt=''
					style={{ width: '100%', height: '100%', objectFit: 'fill' }}
					draggable={false}
				/>
			</div>
		)
	if (el.type === 'video')
		return (
			<div style={style}>
				<video
					data-id={el.id}
					src={el.src}
					style={{ width: '100%', height: '100%', objectFit: 'fill' }}
					autoPlay
					loop
					muted
					playsInline
				/>
			</div>
		)
	if (el.type === 'iframe') {
		const info = parseMediaUrl(el.src || '')
		if (info?.kind === 'youtube')
			return (
				<div style={style}>
					<iframe
						// в плейлисте каждый следующий ролик стартует заново: не глушим его,
						// иначе после автоперехода звук пропадал бы до ручного unmute
						src={youtubeEmbedUrl(info.id, window.location.origin, !el.playlist, !!el.autoplay)}
						title='media'
						ref={setYtFrame}
						style={{ width: '100%', height: '100%', border: 'none' }}
						allow='autoplay; encrypted-media; picture-in-picture'
					/>
					{!ytStarted && (
						<div style={{ position: 'absolute', inset: 0, background: '#000', overflow: 'hidden' }}>
							<img
								src={`https://i.ytimg.com/vi/${info.id}/maxresdefault.jpg`}
								onError={e => {
									const img = e.currentTarget
									if (!img.dataset.fallback) {
										img.dataset.fallback = '1'
										img.src = `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`
									}
								}}
								alt=''
								draggable={false}
								style={{ width: '100%', height: '100%', objectFit: 'cover' }}
							/>
						</div>
					)}
				</div>
			)
		if (info) return (
			<div style={style}>
				<TwitchOverlayFrame el={el} />
			</div>
		)
		const embedSrc = toEmbedUrl(el.src || '')
		// готовый YouTube-плейлист запускаем сразу и со звуком: в OBS автозапуск
		// разрешён, а без autoplay плейлист остался бы на постере
		const autoplayPlaylist =
			!!el.autoplay && /\/embed\/videoseries/.test(embedSrc)
		return (
			<div style={style}>
				<iframe
					src={
						autoplayPlaylist
							? `${embedSrc}${embedSrc.includes('?') ? '&' : '?'}autoplay=1`
							: embedSrc
					}
					title='embed'
					style={{ width: '100%', height: '100%', border: 'none' }}
					allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
					allowFullScreen
				/>
			</div>
		)
	}
	if (el.type === 'text')
		return (
			<div style={{ ...style, ...textBoxStyle(el) }}>
				{el.text}
			</div>
		)
	if (el.type === 'audio') return <AudioOverlay el={el} />
	if (el.type === 'timer') {
		const elapsedMs =
			el.isRunning && el.startTime
				? Math.max(0, Date.now() - serverClockLag.ms - el.startTime) // синхрон между устройствами с разошедшимися часами
				: (el.elapsed || 0)
		const elapsedSec = Math.floor(elapsedMs / 1000)
		const display =
			el.timerDirection === 'down' && el.duration
				? formatTime(Math.max(0, el.duration - elapsedSec))
				: formatTime(elapsedSec)
		// одиночный звуковой сигнал в момент, когда обратный отсчёт дошёл до нуля
		const remaining = el.timerDirection === 'down' && el.duration ? el.duration - elapsedSec : null
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
		return (
			<div
				style={{
					...style,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				{el.timerLabel && (
					<div
						style={{
							fontSize: (el.fontSize || 40) * 0.5,
							color: el.color,
							fontWeight: el.fontWeight,
							marginBottom: 4,
							background: colorWithOpacity(el.bgColor, el.bgOpacity ?? 1),
							padding: '2px 8px',
							borderRadius: 4,
						}}
					>
						{el.timerLabel}
					</div>
				)}
				<div
					style={{
						fontSize: el.fontSize,
						color: el.color,
						fontWeight: el.fontWeight,
						background: colorWithOpacity(el.bgColor, el.bgOpacity ?? 1),
						padding: '4px 12px',
						borderRadius: 6,
						fontFamily: 'monospace',
						letterSpacing: 2,
					}}
				>
					{display}
				</div>
			</div>
		)
	}
	return null
}

// SDK-плеер Twitch на оверлее: чистый кадр (без родных контролов с мышью — их нет),
// управляется командами из панели
function TwitchOverlayFrame({ el }: { el: StreamElement }) {
	const ref = useRef<HTMLDivElement | null>(null)
	useEffect(() => {
		let cancelled = false
		const divId = 'twitchov-' + el.id
		;(async () => {
			try {
				const Tw = await loadTwitchSdk()
				if (cancelled || !ref.current) return
				const info = parseMediaUrl(el.src || '')
				if (!info || info.kind === 'youtube') return
				ref.current.id = divId
				const opts: any = { parent: location.hostname, width: '100%', height: '100%', autoplay: !!el.autoplay, muted: true }
				if (info.kind === 'twitch-channel') opts.channel = info.channel
				else if (info.kind === 'twitch-vod') opts.video = info.id
				else if (info.kind === 'twitch-clip') opts.clip = info.slug
				const p = new Tw.Player(divId, opts)
				twitchPlayers.set(el.id, p)
				p.addEventListener(Tw.Player.PLAY, () => twitchSt.set(el.id, 1))
				p.addEventListener(Tw.Player.PAUSE, () => twitchSt.set(el.id, 2))
			} catch {}
		})()
		return () => {
			cancelled = true
			twitchPlayers.delete(el.id)
			twitchSt.delete(el.id)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [el.id, el.src])
	return <div ref={ref} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
}

function AudioOverlay({ el }: { el: StreamElement }) {
	const ref = useRef<HTMLAudioElement | null>(null)
	// громкость и повтор приходят из состояния элемента; плеер не должен
	// пересоздаваться при изменении этих настроек
	useEffect(() => {
		const a = ref.current
		if (!a) return
		a.volume = Math.max(0, Math.min(1, el.volume ?? 1))
		a.loop = !!el.loop
	}, [el.volume, el.loop])
	return (
		<audio
			ref={ref}
			data-id={el.id}
			src={el.src}
			preload='auto'
			style={{ display: 'none' }}
		/>
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
