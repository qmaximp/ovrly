'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeTelegramChannel } from '@/lib/telegram'

type TelegramPost = {
	text: string
	photo: string
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
	// полная длительность показа в секундах — для полосы прогресса
	duration?: number
	preview?: boolean
}

function TelegramLogo({ size = 22 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox='0 0 24 24' fill='none' aria-hidden='true'>
			<circle cx='12' cy='12' r='12' fill='#2AABEE' />
			<path
				d='M5.4 11.9 18.7 6.7c.6-.2 1.1.1.9.9l-2.2 10.2c-.2.8-.7 1-1.3.6l-3.6-2.7-1.7 1.7c-.2.2-.4.4-.7.4l.2-3.7 6.7-6c.3-.3-.1-.4-.5-.2l-8.2 5.2-3.5-1.1c-.8-.2-.8-.8.2-1.1Z'
				fill='#fff'
			/>
		</svg>
	)
}

function formatWhen(raw: string): string {
	if (!raw) return ''
	const d = new Date(raw)
	if (Number.isNaN(d.getTime())) return raw
	const now = new Date()
	const same =
		d.getDate() === now.getDate() &&
		d.getMonth() === now.getMonth() &&
		d.getFullYear() === now.getFullYear()
	return same
		? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
		: d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function FeedFooter({
	light,
	views,
}: {
	light: boolean
	views?: string
}) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				marginTop: 7,
				fontSize: 9,
				color: light ? '#6b7280' : '#8295a8',
			}}
		>
			<span>{views ? `👁 ${views}` : ''}</span>
			<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
				<span style={{ display: 'inline-flex', gap: 4 }}>
					<span
						style={{
							width: 11,
							height: 11,
							borderRadius: '50%',
							background: '#2AABEE',
							display: 'inline-block',
						}}
					/>
					<span
						style={{
							width: 11,
							height: 11,
							borderRadius: '50%',
							background: '#a855f7',
							display: 'inline-block',
						}}
					/>
					<span
						style={{
							width: 11,
							height: 11,
							borderRadius: '50%',
							background: '#ec4899',
							display: 'inline-block',
						}}
					/>
				</span>
				<span style={{ color: '#2AABEE' }}>Комментарии ›</span>
			</span>
		</div>
	)
}

// Карточка повторяет промо-показ OverlayHub: телефон с лентой постов, большой
// фиолетовый QR и плашка канала. Появление/уход и «живые» покачивания заданы
// в globals.css (.tg-*).
export default function TelegramCard({
	channel,
	showQr = true,
	light = false,
	until,
	duration = 15,
	preview = false,
}: Props) {
	const nick = normalizeTelegramChannel(channel)
	const [phase, setPhase] = useState<'hidden' | 'in' | 'out'>(() => {
		if (preview) return 'in'
		return until && until > Date.now() ? 'in' : 'hidden'
	})

	useEffect(() => {
		if (preview) {
			setPhase('in')
			return
		}
		if (!until) {
			setPhase('hidden')
			return
		}
		const ms = until - Date.now()
		if (ms <= 0) {
			setPhase('hidden')
			return
		}
		setPhase('in')
		let hideTimer: ReturnType<typeof setTimeout> | undefined
		const outTimer = setTimeout(() => {
			setPhase('out')
			hideTimer = setTimeout(() => setPhase('hidden'), 900)
		}, ms)
		return () => {
			clearTimeout(outTimer)
			if (hideTimer) clearTimeout(hideTimer)
		}
	}, [until, preview])

	const [data, setData] = useState<TelegramData | null>(null)
	const [error, setError] = useState('')
	const feedRef = useRef<HTMLDivElement | null>(null)
	const [now, setNow] = useState(Date.now())

	useEffect(() => {
		if (preview || phase !== 'in') return
		const t = setInterval(() => setNow(Date.now()), 120)
		return () => clearInterval(t)
	}, [preview, phase])

	useEffect(() => {
		if (!nick) {
			setData(null)
			setError('')
			return
		}
		let alive = true
		const load = async () => {
			try {
				const res = await fetch(`/api/telegram?channel=${encodeURIComponent(nick)}`)
				const json = await res.json()
				if (!alive) return
				if (!res.ok) {
					setError(json.error || 'Канал не найден')
					return
				}
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

	// Лента в телефоне едет сама, как в эталонной карточке. Небольшая пауза
	// на краях, чтобы посты успевали прочитаться.
	useEffect(() => {
		if (phase !== 'in' || !feedRef.current) return
		const el = feedRef.current
		let dir = 1
		let pause = 40
		const timer = setInterval(() => {
			if (pause > 0) {
				pause -= 1
			} else {
				el.scrollTop += dir * 0.6
				if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
					dir = -1
					pause = 60
				} else if (el.scrollTop <= 0) {
					dir = 1
					pause = 30
				}
			}
		}, 40)
		return () => clearInterval(timer)
	}, [phase, data])

	const qrSrc = useMemo(() => {
		if (!nick) return ''
		return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=20&color=5B4BFF&bgcolor=FFFFFF&data=${encodeURIComponent(
			`https://t.me/${nick}`,
		)}`
	}, [nick])

	const bg = light ? '#f3f7fb' : '#0e1a26'
	const panel = light ? '#e8f2fb' : '#142330'
	const fg = light ? '#111827' : '#f4f8fb'
	const muted = light ? '#64748b' : '#8094a8'
	const line = light ? '#dbe7f2' : '#203346'
	const posts = data?.posts?.length
		? data.posts
		: data?.last
			? [data.last]
			: []
	const totalMs = Math.max(1000, (duration || 15) * 1000)
	const progress = preview
		? 1
		: Math.max(0, Math.min(1, ((until || 0) - now) / totalMs))
	const subscriberLine = data?.subscribers
		? `${data.subscribers} подписчиков`
		: nick
			? `@${nick}`
			: ''

	if (phase === 'hidden') return null

	return (
		<div
			data-telegram-card='1'
			className={`tg-shell${phase === 'out' ? ' tg-out' : ''}`}
			style={{
				width: '100%',
				height: '100%',
				position: 'relative',
				overflow: 'hidden',
				display: 'flex',
				alignItems: 'flex-start',
				gap: '5%',
				padding: '3%',
				boxSizing: 'border-box',
				fontFamily:
					'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
				color: fg,
			}}
		>
			<div
				className='tg-left'
				style={{
					position: 'relative',
					width: showQr ? '34%' : '94%',
					height: '88%',
					flex: '0 0 auto',
					boxSizing: 'border-box',
					display: 'flex',
					flexDirection: 'column',
					borderRadius: 42,
					background: bg,
					backgroundImage: light
						? 'radial-gradient(120% 70% at 80% 105%, rgba(42,171,238,.18), transparent 60%)'
						: 'radial-gradient(120% 70% at 82% 108%, rgba(59,91,255,.26), transparent 62%), radial-gradient(90% 60% at 8% 108%, rgba(32,84,140,.24), transparent 65%)',
					border: '6px solid #d7d9e2',
					boxShadow: '0 26px 70px rgba(0,0,0,.6)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 10,
						padding: '11px 13px',
						borderBottom: `1px solid ${line}`,
						background: panel,
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 6,
							fontSize: 13,
							fontWeight: 700,
							color: muted,
							flex: '0 0 auto',
						}}
					>
						<span style={{ fontSize: 21, lineHeight: 1, marginTop: -2 }}>‹</span>
						<span>67</span>
					</div>
					<div style={{ minWidth: 0, flex: 1, textAlign: 'center' }}>
						<div
							style={{
								fontSize: 13,
								fontWeight: 800,
								lineHeight: 1.15,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
							}}
						>
							{data?.title || (nick ? `@${nick}` : 'Telegram')}
						</div>
						<div
							style={{
								fontSize: 9,
								color: muted,
								marginTop: 2,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
							}}
						>
							{subscriberLine || error || 'Подключение к каналу…'}
						</div>
					</div>
					{data?.avatar ? (
						<img
							src={data.avatar}
							alt=''
							onError={e => {
								e.currentTarget.style.display = 'none'
							}}
							style={{
								width: 36,
								height: 36,
								borderRadius: '50%',
								objectFit: 'cover',
								flex: '0 0 auto',
								background: '#2AABEE22',
							}}
						/>
					) : (
						<div
							style={{
								width: 36,
								height: 36,
								borderRadius: '50%',
								display: 'grid',
								placeItems: 'center',
								background: '#2AABEE22',
								flex: '0 0 auto',
							}}
						>
							<TelegramLogo size={18} />
						</div>
					)}
				</div>

				<div
					ref={feedRef}
					className='tg-feed'
					style={{
						flex: 1,
						minHeight: 0,
						overflowY: 'auto',
						overflowX: 'hidden',
						scrollbarWidth: 'none',
					}}
				>
					{!nick ? (
						<div
							style={{
								height: '100%',
								display: 'grid',
								placeItems: 'center',
								textAlign: 'center',
								padding: 20,
								color: muted,
								fontSize: 12,
								lineHeight: 1.5,
							}}
						>
							Укажите Telegram-канал в свойствах
						</div>
					) : posts.length === 0 ? (
						<div style={{ padding: 16, color: muted, fontSize: 12, lineHeight: 1.5 }}>
							{error || 'Загружаем посты'}
						</div>
					) : (
						posts.map((post, i) => (
							<div
								key={`${post.url}-${i}`}
								className='tg-post'
								style={{
									padding: '11px 13px',
									borderBottom: i === posts.length - 1 ? 'none' : `1px solid ${line}`,
									animationDelay: `${140 + i * 90}ms`,
								}}
							>
								<div
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										gap: 8,
										fontSize: 10,
										color: muted,
										marginBottom: 5,
									}}
								>
									<span style={{ color: '#2AABEE', fontWeight: 700 }}>@{nick}</span>
									<span>{formatWhen(post.date)}</span>
								</div>
								{post.photo && (
									<img
										src={post.photo}
										alt=''
										onError={e => {
											e.currentTarget.style.display = 'none'
										}}
										style={{
											width: '100%',
											height: 86,
											objectFit: 'cover',
											borderRadius: 10,
											marginBottom: 7,
											background: panel,
										}}
									/>
								)}
								<p
									style={{
										margin: 0,
										fontSize: 12,
										lineHeight: 1.42,
										color: light ? '#1f2937' : '#e6edf3',
										display: '-webkit-box',
										WebkitLineClamp: 4,
										WebkitBoxOrient: 'vertical',
										overflow: 'hidden',
									}}
								>
									{post.text || 'Пост без текста'}
								</p>
								<div
									style={{
										display: 'inline-flex',
										gap: 5,
										marginTop: 7,
										fontSize: 9,
									}}
								>
									<span
										style={{
											padding: '2px 7px',
											borderRadius: 999,
											background: light ? '#e8f2fb' : '#172b3d',
											color: light ? '#1f2937' : '#dbeafe',
										}}
									>
										❤️ {1 + (i % 3)}
									</span>
									<span
										style={{
											padding: '2px 7px',
											borderRadius: 999,
											background: light ? '#e8f2fb' : '#172b3d',
											color: light ? '#1f2937' : '#dbeafe',
										}}
									>
										👍 1
									</span>
								</div>
								<FeedFooter light={light} views={post.views} />
							</div>
						))
					)}
				</div>
			</div>

			{showQr && nick && (
				<div
					className='tg-qr-wrap'
					style={{
						position: 'relative',
						width: '33%',
						flex: '0 0 auto',
						marginTop: '2%',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '3%',
					}}
				>
					<div
						className='tg-qr-card'
						style={{
							position: 'relative',
							width: '100%',
							aspectRatio: '1 / 1',
							background: '#fff',
							borderRadius: 36,
							padding: 12,
							boxSizing: 'border-box',
							boxShadow: '0 24px 60px rgba(0,0,0,.5)',
							border: '4px solid #fff',
						}}
					>
						<img
							src={qrSrc}
							alt='QR Telegram'
							onError={e => {
								e.currentTarget.style.display = 'none'
							}}
							style={{
								width: '100%',
								height: '100%',
								objectFit: 'contain',
								display: 'block',
							}}
						/>
						<div
							style={{
								position: 'absolute',
								left: '50%',
								top: '50%',
								transform: 'translate(-50%, -50%)',
								width: '22%',
								aspectRatio: '1 / 1',
								borderRadius: '50%',
								background: '#5b4bdf',
								border: '4px solid #fff',
								display: 'grid',
								placeItems: 'center',
								overflow: 'hidden',
							}}
						>
							{data?.avatar ? (
								<img
									src={data.avatar}
									alt=''
									style={{ width: '100%', height: '100%', objectFit: 'cover' }}
								/>
							) : (
								<span style={{ fontSize: 9, color: '#fff', fontWeight: 800 }}>TG</span>
							)}
						</div>
					</div>
				</div>
			)}

			<a
				className='tg-handle'
				href={nick ? `https://t.me/${nick}` : undefined}
				target='_blank'
				rel='noreferrer'
				style={{
					position: 'absolute',
					right: '10%',
					bottom: '2.5%',
					display: 'inline-flex',
					alignItems: 'center',
					gap: 8,
					padding: '8px 13px',
					borderRadius: 999,
					background: light ? '#eef6ff' : '#000000',
					border: `1px solid ${line}`,
					color: fg,
					textDecoration: 'none',
					fontSize: 13,
					fontWeight: 700,
					boxShadow: '0 10px 30px rgba(0,0,0,.35)',
					maxWidth: '38%',
				}}
			>
				<TelegramLogo size={18} />
				<span
					style={{
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						color: '#2AABEE',
					}}
				>
					{nick ? `@${nick}` : 'Telegram'}
				</span>
			</a>

			<div
				style={{
					position: 'absolute',
					left: '4%',
					right: '4%',
					bottom: '0.8%',
					height: 3,
					borderRadius: 999,
					background: light ? '#dbe7f2' : 'rgba(255,255,255,.12)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						width: `${Math.round(progress * 1000) / 10}%`,
						height: '100%',
						borderRadius: 999,
						background: 'linear-gradient(90deg,#2AABEE,#8B5CF6)',
						transition: 'width .16s linear',
					}}
				/>
			</div>
		</div>
	)
}
