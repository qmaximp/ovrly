'use client'

import { useEffect, useMemo, useState } from 'react'
import { normalizeTelegramChannel } from '@/lib/telegram'

type TelegramData = {
	channel: string
	title: string
	subscribers: string
	description: string
	avatar: string
	url: string
	last?: {
		text: string
		photo: string
		date: string
		views: string
		url: string
	}
}

type Props = {
	channel?: string
	showQr?: boolean
	light?: boolean
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

export default function TelegramCard({
	channel,
	showQr = true,
	light = false,
}: Props) {
	const nick = normalizeTelegramChannel(channel)
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
		return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(
			`https://t.me/${nick}`,
		)}`
	}, [nick])

	const bg = light ? '#ffffff' : '#17212b'
	const fg = light ? '#111827' : '#ffffff'
	const muted = light ? '#6b7280' : '#8b9bab'
	const line = light ? '#e5e7eb' : '#253341'
	const last = data?.last
	const text = last?.text || data?.description || ''

	return (
		<div
			data-telegram-card='1'
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				gap: 10,
				padding: 14,
				boxSizing: 'border-box',
				overflow: 'hidden',
				borderRadius: 16,
				background: bg,
				color: fg,
				fontFamily:
					'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
				{data?.avatar ? (
					<img
						src={data.avatar}
						alt=''
						onError={e => {
							e.currentTarget.style.display = 'none'
						}}
						style={{
							width: 42,
							height: 42,
							borderRadius: '50%',
							objectFit: 'cover',
							flex: '0 0 auto',
							background: '#2AABEE22',
						}}
					/>
				) : (
					<div
						style={{
							width: 42,
							height: 42,
							borderRadius: '50%',
							display: 'grid',
							placeItems: 'center',
							background: '#2AABEE22',
							flex: '0 0 auto',
						}}
					>
						<TelegramLogo />
					</div>
				)}
				<div style={{ minWidth: 0, flex: 1 }}>
					<div
						style={{
							fontSize: 16,
							fontWeight: 750,
							lineHeight: 1.15,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						{data?.title || (nick ? `@${nick}` : 'Telegram')}
					</div>
					<div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
						{data?.subscribers
							? `${data.subscribers} подписчиков`
							: error || 'Подключение к каналу…'}
					</div>
				</div>
				<div
					style={{
						width: 34,
						height: 34,
						borderRadius: 10,
						display: 'grid',
						placeItems: 'center',
						background: light ? '#eef6ff' : '#1f3142',
						flex: '0 0 auto',
					}}
				>
					<TelegramLogo size={20} />
				</div>
			</div>

			<div
				style={{
					display: 'flex',
					gap: 10,
					flex: 1,
					minHeight: 0,
					borderTop: `1px solid ${line}`,
					paddingTop: 10,
				}}
			>
				<div
					style={{
						flex: 1,
						minWidth: 0,
						fontSize: 13,
						lineHeight: 1.45,
						color: light ? '#1f2937' : '#e6edf3',
						overflow: 'hidden',
						display: '-webkit-box',
						WebkitLineClamp: 5,
						WebkitBoxOrient: 'vertical',
						whiteSpace: 'pre-wrap',
					}}
				>
					{nick ? text || 'Загрузка последнего поста…' : 'Укажите Telegram-канал в свойствах'}
				</div>
				{last?.photo && (
					<img
						src={last.photo}
						alt=''
						onError={e => {
							e.currentTarget.style.display = 'none'
						}}
						style={{
							width: 92,
							height: 92,
							objectFit: 'cover',
							borderRadius: 10,
							flex: '0 0 auto',
						}}
					/>
				)}
			</div>

			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 10,
					borderTop: `1px solid ${line}`,
					paddingTop: 10,
				}}
			>
				{showQr && qrSrc ? (
					<img
						src={qrSrc}
						alt='QR Telegram'
						onError={e => {
							e.currentTarget.style.display = 'none'
						}}
						style={{
							width: 62,
							height: 62,
							borderRadius: 8,
							background: '#fff',
							padding: 4,
							boxSizing: 'border-box',
						}}
					/>
				) : null}
				<div style={{ minWidth: 0, flex: 1 }}>
					<div
						style={{
							fontSize: 12,
							fontWeight: 700,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						{nick ? `@${nick}` : 'Telegram'}
					</div>
					<div style={{ fontSize: 11, color: muted, marginTop: 2 }}>
						{last?.views ? `${last.views} просмотров` : data?.description || 'Telegram-канал'}
					</div>
				</div>
				{nick && (
					<a
						href={`https://t.me/${nick}`}
						target='_blank'
						rel='noreferrer'
						style={{
							fontSize: 11,
							color: '#2AABEE',
							textDecoration: 'none',
							fontWeight: 700,
							flex: '0 0 auto',
						}}
					>
						Открыть
					</a>
				)}
			</div>
		</div>
	)
}
