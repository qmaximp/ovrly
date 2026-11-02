'use client'

import { useEffect, useState } from 'react'

type Streamer = {
	login: string
	displayName: string
	avatar: string
	followers: number
	featured: boolean
}

export default function StreamersCarousel() {
	const [items, setItems] = useState<Streamer[]>([])

	useEffect(() => {
		let alive = true
		fetch('/api/streamers')
			.then(r => r.json())
			.then(data => {
				if (alive && Array.isArray(data?.streamers)) {
					setItems(data.streamers)
				}
			})
			.catch(() => {})
		return () => {
			alive = false
		}
	}, [])

	if (!items.length) return null

	// Одна половина ленты — минимум 6 карточек, вторая — её точная копия:
	// тогда сдвиг на -50% даёт бесшовный цикл.
	const base =
		items.length >= 6
			? items
			: Array.from({ length: Math.ceil(6 / items.length) }, () => items).flat()
	const row = [...base, ...base]

	return (
		<section className='container section streamers-section'>
			<div className='section-head'>
				<span className='kicker'>Сообщество</span>
				<h2 className='section-title'>Нам доверяют</h2>
				<p className='section-sub'>
					Стримеры, которые уже используют Ovrly в своих эфирах.
				</p>
			</div>
			<div className='streamers-marquee' aria-label='Стримеры Ovrly'>
				<div className='streamers-track'>
					{row.map((s, i) => (
						<a
							key={`${s.login}-${i}`}
							href={`https://twitch.tv/${s.login}`}
							target='_blank'
							rel='noopener noreferrer'
							className='streamer-card'
							aria-hidden={i >= base.length ? true : undefined}
							tabIndex={i >= base.length ? -1 : 0}
						>
							{s.avatar ? (
								// eslint-disable-next-line @next/next/no-img-element
								<img src={s.avatar} alt='' loading='lazy' />
							) : (
								<span className='streamer-avatar-fallback'>
									{s.displayName.slice(0, 1).toUpperCase()}
								</span>
							)}
							<span className='streamer-meta'>
								<strong>{s.displayName}</strong>
								<span>
									{s.followers.toLocaleString('ru-RU')} подписчиков
								</span>
							</span>
						</a>
					))}
				</div>
			</div>
		</section>
	)
}
