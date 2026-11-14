'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import { normalizeTelegramChannel } from '@/lib/telegram'
import s from './TelegramCard.module.css'

type TelegramMedia = {
	kind: 'photo' | 'video' | 'round' | 'sticker' | 'voice' | 'file'
	url: string
	thumb?: string
	title?: string
}

type TelegramPost = {
	text: string
	photo: string
	media?: TelegramMedia[]
	date: string
	views: string
	url: string
}

type TelegramData = {
	channel: string
	title: string
	subscribers: string
	description: string
	avatar: string
	url: string
	posts: TelegramPost[]
	last?: TelegramPost
}

type Props = {
	channel?: string
	showQr?: boolean
	light?: boolean
	until?: number
	duration?: number
	preview?: boolean
}

const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)'
const EASE_IN = 'cubic-bezier(.55, .05, .8, .25)'

function initials(name: string) {
	const parts = name.trim().split(/\s+/).filter(Boolean)
	return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
}

function isBarePost(post: TelegramPost) {
	return (
		!post.text &&
		!!post.media?.some(m => m.kind === 'round' || m.kind === 'sticker')
	)
}

function shortDate(raw: string) {
	if (!raw) return ''
	const d = new Date(raw)
	if (Number.isNaN(d.getTime())) return raw
	return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function fullDate(raw: string) {
	if (!raw) return ''
	const d = new Date(raw)
	if (Number.isNaN(d.getTime())) return raw
	return d.toLocaleString('ru-RU', {
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function rrect(x: number, y: number, w: number, h: number, tl: number, tr: number, br: number, bl: number) {
	const a = (r: number, ex: number, ey: number) => (r ? `A${r} ${r} 0 0 1 ${ex} ${ey}` : '')
	return `M${x + tl} ${y}H${x + w - tr}${a(tr, x + w, y + tr)}V${y + h - br}${a(br, x + w - br, y + h)}H${x + bl}${a(bl, x, y + h - bl)}V${y + tl}${a(tl, x + tl, y)}Z`
}

function makeQr(nick: string) {
	const qr = qrcode(0, 'M')
	qr.addData(`https://t.me/${nick}`)
	qr.make()
	const n = qr.getModuleCount()
	const mid = n / 2
	const lr = n * 0.165
	const finder = (r: number, c: number) =>
		(r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)
	const logo = (r: number, c: number) =>
		Math.hypot(r + 0.5 - mid, c + 0.5 - mid) < lr + 0.5
	const on = (r: number, c: number) =>
		r >= 0 && c >= 0 && r < n && c < n && !finder(r, c) && !logo(r, c) && qr.isDark(r, c)
	const k = 0.5
	const f = 0.32
	let d = ''
	for (let r = 0; r < n; r++)
		for (let c = 0; c < n; c++) {
			const T = on(r - 1, c)
			const B = on(r + 1, c)
			const L = on(r, c - 1)
			const R = on(r, c + 1)
			if (on(r, c)) {
				d += rrect(
					c,
					r,
					1,
					1,
					!T && !L ? k : 0,
					!T && !R ? k : 0,
					!B && !R ? k : 0,
					!B && !L ? k : 0,
				)
			} else if (!finder(r, c) && !logo(r, c)) {
				if (T && L && on(r - 1, c - 1))
					d += `M${c} ${r}h${f}A${f} ${f} 0 0 0 ${c} ${r + f}z`
				if (T && R && on(r - 1, c + 1))
					d += `M${c + 1} ${r}v${f}A${f} ${f} 0 0 0 ${c + 1 - f} ${r}z`
				if (B && R && on(r + 1, c + 1))
					d += `M${c + 1} ${r + 1}h${-f}A${f} ${f} 0 0 0 ${c + 1} ${r + 1 - f}z`
				if (B && L && on(r + 1, c - 1))
					d += `M${c} ${r + 1}v${-f}A${f} ${f} 0 0 0 ${c + f} ${r + 1}z`
			}
		}
	let ring = ''
	let dots = ''
	for (const [r, c] of [
		[0, 0],
		[0, n - 7],
		[n - 7, 0],
	]) {
		ring +=
			rrect(c, r, 7, 7, 2.4, 2.4, 2.4, 2.4) +
			rrect(c + 1, r + 1, 5, 5, 1.5, 1.5, 1.5, 1.5)
		dots += `<circle cx="${c + 3.5}" cy="${r + 3.5}" r="1.6"/>`
	}
	return {
		n,
		html: `<defs><linearGradient id="qrg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${n}" y2="${n}"><stop offset="0" style="stop-color:#8a7bff"/><stop offset=".5" style="stop-color:#5b4bff"/><stop offset="1" style="stop-color:#3d2fbf"/></linearGradient></defs><g fill="url(#qrg)"><path d="${d}"/><path fill-rule="evenodd" d="${ring}"/>${dots}</g>`,
		avatar: Math.round((580 - 92) * (2 * lr + 0.2) / n),
	}
}

export default function TelegramCard({
	channel,
	showQr = true,
	until,
	preview = false,
}: Props) {
	const nick = normalizeTelegramChannel(channel)
	const [data, setData] = useState<TelegramData | null>(null)
	const [error, setError] = useState('')
	const [visible, setVisible] = useState(false)
	const [scale, setScale] = useState(1)
	const wrapRef = useRef<HTMLDivElement | null>(null)
	const cardRef = useRef<HTMLDivElement | null>(null)
	const qrRef = useRef<HTMLDivElement | null>(null)
	const feedRef = useRef<HTMLDivElement | null>(null)
	const qrSvgRef = useRef<SVGSVGElement | null>(null)
	const qrAvaRef = useRef<HTMLDivElement | null>(null)
	const qrUserRef = useRef<HTMLDivElement | null>(null)
	const enteredRef = useRef<string>('')

	const qr = useMemo(() => (nick ? makeQr(nick) : null), [nick])

	useEffect(() => {
		const el = wrapRef.current
		if (!el) return
		const fit = () => setScale(el.clientWidth / 1920)
		fit()
		const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
		ro?.observe(el)
		return () => ro?.disconnect()
	}, [])

	useEffect(() => {
		if (!nick) {
			setData(null)
			setError('')
			return
		}
		let alive = true
		let tries = 0
		const load = async () => {
			try {
				const res = await fetch(
					`/api/telegram?channel=${encodeURIComponent(nick)}&v=3`,
					{ cache: 'no-store' },
				)
				const json = await res.json()
				if (!alive) return
				// 202 — кэша ещё нет, мост сейчас скачает канал: ждём и пробуем снова.
				if (res.status === 202) {
					if (tries < 8) {
						tries += 1
						setTimeout(() => {
							if (alive) void load()
						}, 4000)
					}
					return
				}
				if (!res.ok) {
					setError(json.error || 'Канал не найден')
					// Новый канал появляется в кэше только после прогона моста на ПК:
					// первые полминуты пробуем чаще, дальше — обычный интервал.
					if (tries < 4) {
						tries += 1
						setTimeout(() => {
							if (alive) void load()
						}, 8000)
					}
					return
				}
				tries = 0
				setData(json)
				setError('')
			} catch {
				if (alive) setError('Нет связи с Telegram')
			}
		}
		void load()
		const timer = setInterval(load, 5 * 60 * 1000)
		return () => {
			alive = false
			clearInterval(timer)
		}
	}, [nick])

	useEffect(() => {
		let hideTimer: ReturnType<typeof setTimeout> | undefined
		if (preview) {
			setVisible(true)
			return
		}
		if (!until) {
			setVisible(false)
			return
		}
		const left = until - Date.now()
		if (left <= 0) {
			setVisible(false)
			return
		}
		setVisible(true)
		const outTimer = setTimeout(() => {
			const card = cardRef.current
			const qrEl = qrRef.current
			card?.animate(
				[{ transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(1300px) rotate(8deg)' }],
				{ duration: 1100, easing: EASE_IN, fill: 'forwards' },
			)
			qrEl?.animate(
				[{ transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(1300px) rotate(-7deg)' }],
				{ duration: 1100, delay: 140, easing: EASE_IN, fill: 'forwards' },
			)
			hideTimer = setTimeout(() => setVisible(false), 1300)
		}, left)
		return () => {
			clearTimeout(outTimer)
			if (hideTimer) clearTimeout(hideTimer)
		}
	}, [until, preview])

	// Вход запускаем сразу, не дожидаясь данных канала: иначе при недоступном
	// Telegram (сервер в РФ) карточка навсегда оставалась невидимой.
	// Когда данные пришли (число постов изменилось) — вход повторяем, чтобы
	// лента успела прокрутиться.
	useEffect(() => {
		if (!visible) return
		const key = `${until || 0}:${data?.channel || nick || ''}:${posts.length}`
		if (enteredRef.current === key) return
		enteredRef.current = key

		const card = cardRef.current
		const qrEl = qrRef.current
		const wrap = wrapRef.current
		const starting = !!until && until > Date.now()
		if (wrap && (!preview || starting)) wrap.style.visibility = 'hidden'
		card?.animate(
			[{ transform: 'translateY(1250px) rotate(-8deg)' }, { transform: 'translateY(0) rotate(0deg)' }],
			{ duration: 1600, easing: EASE_OUT, fill: 'both' },
		)
		qrEl?.animate(
			[{ transform: 'translateY(1250px) rotate(7deg)' }, { transform: 'translateY(0) rotate(0deg)' }],
			{ duration: 1600, delay: 220, easing: EASE_OUT, fill: 'both' },
		)

		const feed = feedRef.current
		let scrollDur = 0
		if (feed) {
			const hidden = feed.offsetHeight - (780 - 96)
			const dist = hidden > 80 ? Math.min(hidden, 560) : 0
			scrollDur = dist ? 1500 + dist * 1.8 : 0
			if (dist)
				feed.animate(
					[{ transform: `translateY(${dist}px)` }, { transform: 'translateY(0)' }],
					{ duration: scrollDur, delay: 600, easing: 'cubic-bezier(.45, .05, .2, 1)', fill: 'both' },
				)
		}

		const svg = qrSvgRef.current
		if (svg) {
			svg.style.removeProperty('--rev')
			svg.classList.remove(s.reveal)
			setTimeout(() => svg.classList.add(s.reveal), 500)
		}
		qrAvaRef.current?.animate(
			[{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
			{ duration: 700, delay: 1000, easing: 'cubic-bezier(.34, 1.25, .64, 1)', fill: 'both' },
		)
		qrUserRef.current?.animate(
			[{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
			{ duration: 900, delay: 750, easing: EASE_OUT, fill: 'both' },
		)

		const reacts = feed?.querySelectorAll('[data-react]') || []
		reacts.forEach((node, index) =>
			node.animate(
				[{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
				{ duration: 650, delay: 600 + scrollDur * 0.7 + index * 70, easing: 'cubic-bezier(.34, 1.25, .64, 1)', fill: 'both' },
			),
		)
		if (wrap) wrap.style.visibility = 'visible'
	}, [visible, data, until])

	if (!visible) return null
	const posts = data?.posts?.length ? data.posts : data?.last ? [data.last] : []
	const subtitle = data?.subscribers
		? `${data.subscribers} подписчиков`
		: nick
			? `@${nick}`
			: error || 'подключение…'

	return (
		<div
			ref={wrapRef}
			className={s.wrap}
			style={{
				visibility:
					preview && (!until || until <= Date.now()) ? 'visible' : 'hidden',
			}}
		>
			<div className={s.stage} style={{ transform: `scale(${scale})` }}>
				<div ref={cardRef} className={`${s.fly} ${s.cardFly}`}>
					<div className={s.rockA}>
						<div className={s.floatA}>
							<div className={s.phone}>
								<div className={s.wall}>
									<div className={s.pattern} />
								</div>
								<div ref={feedRef} className={s.feed}>
									{posts.map((post, index) => (
										<div
											key={`${post.date}-${index}`}
											className={`${s.msg}${isBarePost(post) ? ` ${s.bare}` : ''}`}
										>
											{!isBarePost(post) && (
												<>
													<svg className={s.tail} viewBox='0 0 12 18'>
														<path d='M12 0v18H0c4.6-1 8-4.6 9.4-9.6C10.6 4.3 11.1 1.8 12 0z' />
													</svg>
													<div className={s.msgHead}>
														<span>@{nick}</span>
														<span
															style={{
																float: 'right',
																color: '#8798ac',
																fontWeight: 500,
																fontSize: 12,
															}}
														>
															{shortDate(post.date)}
														</span>
													</div>
												</>
											)}
											{(() => {
												const items =
													post.media?.length
														? post.media
														: post.photo
															? [{ kind: 'photo' as const, url: post.photo }]
															: []
												if (!items.length) return null
												return (
													<div className={s.mediaRow}>
														{items.slice(0, 3).map((m, i) => {
															if (m.kind === 'photo' || m.kind === 'sticker')
																return (
																	<img
																		key={i}
																		className={m.kind === 'sticker' ? s.sticker : s.mediaPhoto}
																		src={m.url}
																		alt=''
																		onError={e => {
																			e.currentTarget.style.display = 'none'
																		}}
																	/>
																)
															if (m.kind === 'voice')
																return (
																	<audio key={i} className={s.voice} controls src={m.url} />
																)
															if (m.kind === 'file')
																return (
																	<a key={i} className={s.file} href={m.url} target='_blank' rel='noreferrer'>
																		{m.title || 'Файл'}
																	</a>
																)
															if (m.kind === 'round')
																return (
																	<div
																		key={i}
																		className={s.round}
																		style={{
																			backgroundImage: m.thumb
																				? `url(${m.thumb})`
																				: undefined,
																		}}
																	>
																		{m.url && (
																			<video
																				className={s.roundVideo}
																				src={m.url}
																				muted
																				loop
																				playsInline
																				autoPlay
																			/>
																		)}
																		<div className={s.roundPlay}>
																			<span className={s.roundPlayIcon} />
																		</div>
																	</div>
																)
															return (
																<video
																	key={i}
																	className={s.mediaVideo}
																	src={m.url}
																	muted
																	loop
																	playsInline
																	autoPlay
																/>
															)
														})}
													</div>
												)
											})()}
											<div className={s.msgText}>{post.text || ''}</div>
											<div className={s.reacts}>
												<span data-react className={s.react}>
													<span>❤️</span>
													<span>1</span>
												</span>
												<span data-react className={s.react}>
													<span>👍</span>
													<span>1</span>
												</span>
											</div>
											<div className={s.meta}>
												<span>👁 {post.views || '—'}</span>
												<span>{fullDate(post.date)}</span>
											</div>
											<div className={s.comments}>
												<span className={s.avs}>
													<i style={{ background: '#2AABEE' }} />
													<i style={{ background: '#9B51E0' }} />
													<i style={{ background: '#F2994A' }} />
												</span>
												<span>Комментарии</span>
												<svg viewBox='0 0 24 24'>
													<path d='M9 5l7 7-7 7' fill='none' stroke='currentColor' strokeWidth='2' />
												</svg>
											</div>
										</div>
									))}
								</div>
								<div className={s.topFade} />
								<header className={s.bar}>
									<div className={`${s.glass} ${s.back}`}>
										<svg viewBox='0 0 24 24'>
											<path d='M15 4.5 7.5 12l7.5 7.5' fill='none' stroke='#fff' strokeWidth='2.6' strokeLinecap='round' strokeLinejoin='round' />
										</svg>
										<span>67</span>
									</div>
									<div className={`${s.glass} ${s.title}`}>
										<div className={s.name}>
											<span>{data?.title || (nick ? `@${nick}` : 'Telegram')}</span>
											<svg className={s.verified} viewBox='0 0 24 24'>
												<path fill='#3e9df5' d='M12 2.6l2.1 1.6 2.6-.4 1.3 2.2 2.3 1.2-.5 2.6 1.6 2.1-1.6 2.1.5 2.6-2.3 1.2-1.3 2.2-2.6-.4L12 21.4l-2.1-1.6-2.6.4-1.3-2.2-2.3-1.2.5-2.6L2.6 12l1.6-2.1-.5-2.6 2.3-1.2 1.3-2.2 2.6.4z' />
												<path d='M7.9 12.3l2.7 2.7 5.6-5.7' fill='none' stroke='#fff' strokeWidth='2.1' strokeLinecap='round' strokeLinejoin='round' />
											</svg>
										</div>
										<div className={s.subs}>{subtitle}</div>
									</div>
									<div className={s.ava}>
										{data?.avatar ? (
											<img src={data.avatar} alt='' />
										) : (
											<div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'linear-gradient(#ff885e,#ff516a)', fontWeight: 700 }}>
												{initials(data?.title || nick || 'TG')}
											</div>
										)}
									</div>
								</header>
							</div>
						</div>
					</div>
				</div>

				{showQr && qr && (
					<div ref={qrRef} className={`${s.fly} ${s.qrFly}`}>
						<div className={s.rockB}>
							<div className={s.floatB}>
								<div className={s.qrGlow} />
								<div className={s.qrCard}>
									<svg
										ref={qrSvgRef}
										className={s.qrSvg}
										viewBox={`0 0 ${qr.n} ${qr.n}`}
										dangerouslySetInnerHTML={{ __html: qr.html }}
									/>
									<div
										ref={qrAvaRef}
										className={s.qrAva}
										style={{
											width: qr.avatar,
											height: qr.avatar,
											marginLeft: -qr.avatar / 2,
											marginTop: -qr.avatar / 2,
										}}
									>
										{data?.avatar ? <img src={data.avatar} alt='' /> : null}
									</div>
								</div>
								<div ref={qrUserRef} className={s.qrUser}>
									<div className={s.tgLogo}>
										<svg viewBox='0 0 24 24'>
											<path fill='#fff' d='M4.6 11.4 18.1 6.2c.7-.2 1.2.2 1 1.1l-2.3 10.8c-.2.8-.7 1-1.4.6l-3.6-2.6-1.7 1.7c-.2.2-.4.3-.8.3l.3-3.6 6.5-5.9c.3-.3-.1-.4-.4-.2l-8 5.1-3.5-1.1c-.8-.2-.8-.8.2-1.1z' />
										</svg>
									</div>
									<span>@{nick || 'telegram'}</span>
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
