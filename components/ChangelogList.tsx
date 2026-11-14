'use client'

import { useEffect, useState } from 'react'

type ChangelogEntry = {
	id?: string
	text: string
	date: string
	url: string
	photo?: string
}

type ChangelogData = {
	channel: string
	title: string
	url: string
	entries: ChangelogEntry[]
	error?: string
}

function formatDate(value: string) {
	const ts = Date.parse(value)
	if (!ts) return ''
	return new Intl.DateTimeFormat('ru-RU', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	}).format(ts)
}

export default function ChangelogList() {
	const [data, setData] = useState<ChangelogData | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	useEffect(() => {
		let alive = true
		fetch('/api/changelog', { cache: 'no-store' })
			.then(async res => {
				const json = await res.json()
				if (!res.ok) throw new Error(json?.error || 'Не удалось загрузить обновления')
				if (alive) setData(json)
			})
			.catch(e => {
				if (alive) setError(e?.message || 'Не удалось загрузить обновления')
			})
			.finally(() => {
				if (alive) setLoading(false)
			})
		return () => {
			alive = false
		}
	}, [])

	// Новые обновления — сверху, старые — ниже
	const entries = [...(data?.entries || [])].sort(
		(a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0),
	)

	if (loading) {
		return <p className='cabinet-muted'>Загружаю обновления…</p>
	}

	if (!entries.length) {
		return (
			<div className='glass-card cabinet-empty'>
				<h2 className='cabinet-section-title'>Обновления скоро появятся</h2>
				<p className='cabinet-muted'>
					{error ||
						data?.error ||
						'Пока здесь пусто — новые изменения появятся сразу после публикации.'}
				</p>
			</div>
		)
	}

	return (
		<div className='cabinet-updates'>
			{entries.map((entry, i) => (
				<article
					key={entry.id || entry.url || i}
					className='glass-card cabinet-update'
				>
					<header className='cabinet-update-head'>
						<time dateTime={entry.date}>{formatDate(entry.date)}</time>
						{entry.url && (
							<a
								href={entry.url}
								target='_blank'
								rel='noopener noreferrer'
								className='cabinet-update-link'
							>
								Открыть ↗
							</a>
						)}
					</header>
					{entry.photo && (
						<img
							src={entry.photo}
							alt=''
							loading='lazy'
							className='cabinet-update-photo'
						/>
					)}
					{entry.text && <p className='cabinet-update-text'>{entry.text}</p>}
				</article>
			))}

			{data?.url && (
				<a
					href={data.url}
					target='_blank'
					rel='noopener noreferrer'
					className='btn btn-ghost btn-sm cabinet-updates-all'
				>
					Все обновления в Telegram ↗
				</a>
			)}
		</div>
	)
}
