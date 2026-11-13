'use client'

import { useEffect, useMemo, useState } from 'react'
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
	// момент окончания показа (ms). undefined/0 — карточка скрыта на оверлее
	until?: number
	// в панели карточка видна всегда, чтобы её можно было настроить
	preview?: boolean
}

function TelegramLogo({ size = 22 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			aria-hidden='true'
		>
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

// Карточка Telegram в духе overlay.hub: живая композиция из ленты, большого QR
// и плашки канала. Появление анимировано через CSS (.tg-* в globals.css).
export default function TelegramCard({
	channel,
	showQr = true,
	light = false,
	until,
	preview = false,
}: Props) {
	const nick = normalizeTelegramChannel(channel)
	const [hidden, setHidden] = useState(
		() => !preview && (!until || until <= Date.now()),
	)

	useEffect(() => {
		setHidden(false)
		if (preview) return
		if (!until) {
			setHidden(true)
			return
		}
		const ms = until - Date.now()
		if (ms <= 0) {
			setHidden(true)
			return
		}
		const t = setTimeout(() => setHidden(true), ms)
		return () => clearTimeout(t)
	}, [until, preview])

	const [data, setData] = useState<TelegramData | null>(null)
	const [error, setError] = useState('')

	useEffect(() => {
		if (!nick) {
			setData(null)
			setError('')
			return
		}
		let alive = true
		const load = async () => {
			try {
				const res = await fetch(
					`/api/telegram?channel=${encodeURIComponent(nick)}`,
				)
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

	const qrSrc = useMemo(() => {
		if (!nick) return ''
		return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=0&data=${encodeURIComponent(
			`https://t.me/${nick}`,
		)}`
	}, [nick])

	const bg = light ? '#ffffff' : '#17212b'
	const panel = light ? '#f6f8fa' : '#1c2733'
	const fg = light ? '#111827' : '#ffffff'
	const muted = light ? '#6b7280' : '#8b9bab'
	const line = light ? '#e5e7eb' : '#2b3b4b'
	const posts = data?.posts?.length
		? data.posts
		: data?.last
			? [data.last]
			: []

	if (!preview && hidden) return null
	return (
		<div
			data-telegram-card='1'
			className='tg-shell'
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
					borderRadius: 34,
					background: bg,
					border: '3px solid #516172',
					boxShadow: '0 18px 50px rgba(0,0,0,.45)',
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						padding: '12px 14px',
						borderBottom: `1px solid ${line}`,
						fontSize: 11,
						letterSpacing: '.06em',
						textTransform: 'uppercase',
						color: muted,
					}}
				>
					<span>Комментарии</span>
					<TelegramLogo size={16} />
				</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 10,
						padding: '10px 14px',
						borderBottom: `1px solid ${line}`,
					}}
				>
					{data?.avatar ? (
						<img
							src={data.avatar}
							alt=''
							onError={e => {
								e.currentTarget.style.display = 'none'
							}}
							style={{
								width: 38,
								height: 38,
								borderRadius: '50%',
								objectFit: 'cover',
								flex: '0 0 auto',
								background: '#2AABEE22',
							}}
						/>
					) : (
						<div
							style={{
								width: 38,
								height: 38,
								borderRadius: '50%',
								display: 'grid',
								placeItems: 'center',
								background: '#2AABEE22',
								flex: '0 0 auto',
							}}
						>
							<TelegramLogo size={20} />
						</div>
					)}
					<div style={{ minWidth: 0, flex: 1 }}>
						<div
							style={{
								fontSize: 14,
								fontWeight: 750,
								lineHeight: 1.2,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
							}}
						>
							{data?.title || (nick ? `@${nick}` : 'Telegram')}
						</div>
						<div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
							{data?.subscribers
								? `${data.subscribers} подписчиков`
								: error || 'Подключение к каналу…'}
						</div>
					</div>
				</div>

				<div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
							Укажите Telegram-канал в свойствах элемента
						</div>
					) : posts.length === 0 ? (
						<div
							style={{
								padding: 16,
								color: muted,
								fontSize: 12,
								lineHeight: 1.5,
							}}
						>
							{error || 'Загрузка постов…'}
						</div>
					) : (
						posts.map((post, i) => (
							<div
								key={`${post.url}-${i}`}
								className='tg-post'
								style={{
									padding: '10px 14px',
									borderBottom:
										i === posts.length - 1 ? 'none' : `1px solid ${line}`,
									animationDelay: `${120 + i * 110}ms`,
								}}
							>
								<div
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										gap: 8,
										fontSize: 10,
										color: muted,
										marginBottom: 4,
									}}
								>
									<span style={{ color: '#2AABEE', fontWeight: 700 }}>
										@{nick}
									</span>
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
											height: 74,
											objectFit: 'cover',
											borderRadius: 8,
											marginBottom: 6,
										}}
									/>
								)}
								<p
									style={{
										margin: 0,
										fontSize: 12,
										lineHeight: 1.45,
										color: light ? '#1f2937' : '#e6edf3',
										display: '-webkit-box',
										WebkitLineClamp: 3,
										WebkitBoxOrient: 'vertical',
										overflow: 'hidden',
									}}
								>
									{post.text || 'Медиа-пост'}
								</p>
								<div
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										marginTop: 5,
										fontSize: 10,
										color: muted,
									}}
								>
									<span>{post.views ? `👁 ${post.views}` : ''}</span>
									<span>Комментарии ›</span>
								</div>
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
						width: '40%',
						flex: '0 0 auto',
						marginTop: '4%',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '3%',
					}}
				>
					<div
						style={{
							fontSize: 12,
							fontWeight: 600,
							letterSpacing: '0.18em',
							color: light ? '#334155' : '#d9e9f4',
							textTransform: 'uppercase',
							whiteSpace: 'nowrap',
						}}
					>
						Мы в Telegram
					</div>
					<div
						className='tg-qr-card'
						style={{
							position: 'relative',
							width: '100%',
							aspectRatio: '1 / 1',
							background: '#fff',
							borderRadius: 26,
							padding: 8,
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
								borderRadius: 16,
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
								width: '26%',
								aspectRatio: '1 / 1',
								borderRadius: '50%',
								background: '#17212b',
								border: '3px solid #fff',
								display: 'grid',
								placeItems: 'center',
								overflow: 'hidden',
							}}
						>
							{data?.avatar ? (
								<img
									src={data.avatar}
									alt=''
									style={{
										width: '100%',
										height: '100%',
										objectFit: 'cover',
									}}
								/>
							) : (
								<TelegramLogo size={20} />
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
					right: '4%',
					bottom: '3%',
					display: 'inline-flex',
					alignItems: 'center',
					gap: 8,
					padding: '8px 13px',
					borderRadius: 999,
					background: light ? '#eef6ff' : '#1b2733',
					border: `1px solid ${line}`,
					color: fg,
					textDecoration: 'none',
					fontSize: 13,
					fontWeight: 700,
					boxShadow: '0 10px 30px rgba(0,0,0,.35)',
					maxWidth: '55%',
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
		</div>
	)
}
