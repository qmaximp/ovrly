'use client'

import { useEffect, useRef, useState } from 'react'

type ChangelogEntry = {
	text: string
	date: string
	url: string
	photo?: string
}

type ChangelogData = {
	channel: string
	title: string
	url: string
	updatedAt: number
	entries: ChangelogEntry[]
	error?: string
}

function formatDate(raw: string) {
	const date = new Date(raw)
	if (Number.isNaN(date.getTime())) return raw || ''
	return date.toLocaleDateString('ru-RU', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	})
}

export default function ChangelogDialog({
	open,
	onClose,
}: {
	open: boolean
	onClose: () => void
}) {
	const [data, setData] = useState<ChangelogData | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const closeRef = useRef<HTMLButtonElement | null>(null)

	useEffect(() => {
		if (!open) return
		setLoading(true)
		setError('')
		fetch('/api/changelog', { cache: 'no-store' })
			.then(async res => {
				const json = await res.json()
				if (!res.ok) throw new Error(json?.error || 'Не удалось загрузить')
				setData(json)
			})
			.catch(e => setError(e?.message || 'Не удалось загрузить обновления'))
			.finally(() => setLoading(false))
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		window.setTimeout(() => closeRef.current?.focus(), 40)
		return () => window.removeEventListener('keydown', onKey)
	}, [open, onClose])

	if (!open) return null

	return (
		<div
			className='changelog-overlay'
			role='presentation'
			onMouseDown={e => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<section
				className='changelog-dialog'
				role='dialog'
				aria-modal='true'
				aria-labelledby='changelog-title'
			>
				<header className='changelog-head'>
					<div>
						<h2 id='changelog-title'>Список обновлений</h2>
					</div>
					<button
						ref={closeRef}
						onClick={onClose}
						className='changelog-close'
						aria-label='Закрыть список обновлений'
					>
						✕
					</button>
				</header>

				{loading ? (
					<p className='changelog-state'>Загружаю обновления…</p>
				) : error ? (
					<p className='changelog-state changelog-error'>{error}</p>
				) : !data || (!data.channel && data.entries.length === 0) ? (
					<p className='changelog-state'>Обновления скоро появятся.</p>
				) : data.entries.length === 0 ? (
					<p className='changelog-state'>
						Обновления скоро появятся.
					</p>
				) : (
					<>
						<p className='changelog-source'>
							Источник:{' '}
							{data.url ? (
								<a href={data.url} target='_blank' rel='noopener noreferrer'>
									{data.title || `@${data.channel}`}
								</a>
							) : (
								<span>{data.title || 'Ovrly'}</span>
							)}
						</p>
						<div className='changelog-list'>
							{data.entries.map((entry, index) => (
								<article
									key={`${entry.url}-${index}`}
									className='changelog-entry'
								>
									<div className='changelog-entry-head'>
										<time>{formatDate(entry.date)}</time>
										<a
											href={entry.url}
											target='_blank'
											rel='noopener noreferrer'
										>
											Открыть в Telegram ↗
										</a>
									</div>
									{entry.photo && (
										<img
											src={entry.photo}
											alt=''
											loading='lazy'
											className='changelog-photo'
										/>
									)}
									{entry.text && (
										<p className='changelog-text'>{entry.text}</p>
									)}
								</article>
							))}
						</div>
						{data.url && (
							<a
								href={data.url}
								target='_blank'
								rel='noopener noreferrer'
								className='btn btn-ghost btn-sm changelog-all'
							>
								Все обновления в Telegram ↗
							</a>
						)}
					</>
				)}
				<button
					onClick={onClose}
					className='changelog-bottom-btn'
				>
					Список обновлений
				</button>
			</section>
		</div>
	)
}
