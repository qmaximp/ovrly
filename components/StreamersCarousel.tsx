'use client'

import { useEffect, useState } from 'react'

type Streamer = {
	login: string
	displayName: string
	avatar: string
	followers: number
	featured: boolean
}

function StreamerCard({ s }: { s: Streamer }) {
	return (
		<a
			href={`https://twitch.tv/${s.login}`}
			target='_blank'
			rel='noopener noreferrer'
			className='streamer-card'
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
				<span>{s.followers.toLocaleString('ru-RU')} подписчиков</span>
			</span>
		</a>
	)
}

// Одна лента: слева направо или справа налево. Половины одинаковые, поэтому
// сдвиг на -50% даёт бесшовный цикл.
function MarqueeRow({
	items,
	total,
	reverse,
	label,
}: {
	items: Streamer[]
	total: number
	reverse?: boolean
	label: string
}) {
	const animate = total >= 3 && items.length >= 2
	const base = animate
		? items.length >= 6
			? items
			: Array.from({ length: Math.ceil(6 / items.length) }, () => items).flat()
		: items
	const row = animate ? [...base, ...base] : base

	return (
		<div className='streamers-marquee' aria-label={label}>
			<div
				className={`streamers-track${reverse ? ' is-reverse' : ''}${animate ? '' : ' is-static'}`}
			>
				{row.map((s, i) => (
					<div
						key={`${s.login}-${i}`}
						aria-hidden={i >= base.length ? true : undefined}
					>
						<StreamerCard s={s} />
					</div>
				))}
			</div>
		</div>
	)
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

	// Чётные — верхний ряд, нечётные — нижний. Так два ряда не повторяют
	// одних и тех же людей.
	const top = items.filter((_, i) => i % 2 === 0)
	const bottom = items.filter((_, i) => i % 2 === 1)

	return (
		<section className='container section streamers-section'>
			<div className='section-head'>
				<span className='kicker'>Сообщество</span>
				<h2 className='section-title'>Нам доверяют</h2>
				<p className='section-sub'>
					Стримеры, которые доверяют Ovrly.
				</p>
			</div>
			<div className='streamers-rows'>
				<MarqueeRow items={top} total={items.length} label='Стримеры Ovrly' />
				{bottom.length > 0 && (
					<MarqueeRow
						items={bottom}
						total={items.length}
						reverse
						label='Стримеры Ovrly, второй ряд'
					/>
				)}
			</div>
		</section>
	)
}
