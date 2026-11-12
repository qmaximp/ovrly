'use client'

// Анимации лендинга. Только transform/opacity + пауза, когда макет вне
// экрана или вкладка скрыта — так браузер почти не тратит CPU.
import { useEffect } from 'react'
import gsap from 'gsap'

export default function LandingMotion() {
	useEffect(() => {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

		const mock = document.querySelector<HTMLElement>('.mock')
		const canvas = document.querySelector<HTMLElement>('.mock-canvas')
		const cursor = document.querySelector<HTMLElement>('.mock-cursor')
		const cardC = document.querySelector<HTMLElement>('.mock-card-c')
		const cardB = document.querySelector<HTMLElement>('.mock-card-b')
		const ring = document.querySelector<HTMLElement>('.mock-ring')
		const pillNew = document.querySelector<HTMLElement>('.mock-pill-new')
		const chip = document.querySelector<HTMLElement>('.mock-chip')

		// у карточек и курсора есть CSS-анимации: гасим их, дальше рулит GSAP
		for (const el of [cardB, cardC, cursor]) {
			if (el) el.style.animation = 'none'
		}

		let tl: gsap.core.Timeline | null = null
		let io: IntersectionObserver | null = null

		const build = () => {
			if (!canvas || !cursor || !cardC || !cardB || !ring || !pillNew) return
			const cv = canvas.getBoundingClientRect()
			const c = cardC.getBoundingClientRect()
			const cur = cursor.getBoundingClientRect()

			// куда курсору прыгнуть, чтобы «взять» карточку
			const toCard = {
				x: c.left + c.width / 2 - cur.left - 4,
				y: c.top + c.height / 2 - cur.top - 6,
			}
			// и куда утащить карточку
			const drop = { x: cv.width * 0.16, y: -cv.height * 0.12 }
			// кольцо ставим ровно в центр карточки, чтобы пульс был «по месту»
			const ringBase = {
				x: c.left + c.width / 2 - (cv.left + cv.width / 2),
				y: c.top + c.height / 2 - (cv.top + cv.height / 2),
			}

			tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4, defaults: { ease: 'power2.out' } })
			tl.set(cursor, { x: 0, y: 0 })
				.set(cardC, { x: 0, y: 0, rotate: 3, scale: 1 })
				.set(ring, { ...ringBase, scale: 0.4, opacity: 0 })

				// 1. добавляем элемент в сайдбар
				.fromTo(
					pillNew,
					{ opacity: 0, x: -14 },
					{ opacity: 1, x: 0, duration: 0.45 },
					'-=0.2',
				)
				// 2. и сразу «создаём» его на холсте
				.fromTo(
					cardC,
					{ opacity: 0, scale: 0.55, rotate: -8 },
					{ opacity: 1, scale: 1, rotate: 3, duration: 0.55, ease: 'back.out(2)' },
					'-=0.25',
				)
				.fromTo(
					ring,
					{ ...ringBase, scale: 0.4, opacity: 0.9 },
					{ scale: 1.6, opacity: 0, duration: 0.7 },
					'<',
				)

				// 3. курсор подходит к карточке
				.to(cursor, { ...toCard, duration: 0.8, ease: 'power2.inOut' })
				// 4. захват
				.to(cardC, { scale: 1.05, duration: 0.18 })
				// 5. тащим вместе с курсором
				.to([cardC, cursor], {
					x: (i: number) => (i === 0 ? drop.x : toCard.x + drop.x),
					y: (i: number) => (i === 0 ? drop.y : toCard.y + drop.y),
					duration: 1.1,
					ease: 'power2.inOut',
				})
				// 6. отпускаем
				.to(cardC, { scale: 1, rotate: 8, duration: 0.25, ease: 'back.out(3)' })
				.fromTo(
					ring,
					{ x: ringBase.x + drop.x, y: ringBase.y + drop.y, scale: 0.5, opacity: 0.8 },
					{ scale: 1.8, opacity: 0, duration: 0.6 },
				)
				// 7. заодно растягиваем оранжевую карточку
				.to(cardB, { scaleX: 1.15, scaleY: 0.9, duration: 0.5, yoyo: true, repeat: 1 })
				// 8. и подсвечиваем таймер
				.to(chip, { scale: 1.12, duration: 0.18, yoyo: true, repeat: 1 }, '-=0.4')
				.to(cursor, { x: 0, y: 0, duration: 0.7, ease: 'power2.inOut' }, '-=0.2')
				.to({}, { duration: 0.6 })

			tl.play(0)
		}

		build()

		// курсор-макет: наклон за мышью только на устройствах с мышью
		const onMove = (e: PointerEvent) => {
			if (!mock || e.pointerType !== 'mouse') return
			const r = mock.getBoundingClientRect()
			const dx = (e.clientX - (r.left + r.width / 2)) / r.width
			const dy = (e.clientY - (r.top + r.height / 2)) / r.height
			gsap.to(mock, {
				rotateY: dx * 6,
				rotateX: -dy * 5,
				duration: 0.6,
				overwrite: 'auto',
				transformPerspective: 900,
				ease: 'power2.out',
			})
		}
		const onLeave = () => {
			if (mock) gsap.to(mock, { rotateX: 0, rotateY: 0, duration: 0.8, ease: 'power2.out' })
		}
		if (mock && window.matchMedia('(pointer: fine)').matches) {
			mock.addEventListener('pointermove', onMove)
			mock.addEventListener('pointerleave', onLeave)
		}

		// пауза вне экрана и при скрытой вкладке
		const setPaused = (paused: boolean) => {
			if (!tl) return
			if (paused) tl.pause()
			else tl.resume()
		}
		if (mock && 'IntersectionObserver' in window) {
			io = new IntersectionObserver(es => setPaused(!es[0]?.isIntersecting), {
				threshold: 0.1,
			})
			io.observe(mock)
		}
		const onVis = () => setPaused(document.hidden)
		document.addEventListener('visibilitychange', onVis)

		// плавное раскрытие FAQ средствами GSAP — без анимации высоты в CSS
		const details = Array.from(document.querySelectorAll<HTMLDetailsElement>('.faq details'))
		const onToggle = (e: Event) => {
			const d = e.currentTarget as HTMLDetailsElement
			const body = d.querySelector<HTMLElement>('.faq-answer')
			if (!body) return
			if (d.open) {
				gsap.fromTo(
					body,
					{ opacity: 0, y: -6 },
					{ opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' },
				)
			}
		}
		details.forEach(d => d.addEventListener('toggle', onToggle))

		// появление блоков при скролле: один IntersectionObserver на всё
		const groups = ['.features-grid', '.steps', '.faq']
			.map(sel => document.querySelector<HTMLElement>(sel))
			.filter(Boolean) as HTMLElement[]
		for (const g of groups) {
			const kids = Array.from(g.children) as HTMLElement[]
			gsap.set(kids, { opacity: 0, y: 18 })
		}
		const revealIO = new IntersectionObserver(
			entries => {
				for (const e of entries) {
					if (!e.isIntersecting) continue
					const kids = Array.from(e.target.children) as HTMLElement[]
					gsap.to(kids, {
						opacity: 1,
						y: 0,
						duration: 0.5,
						stagger: 0.06,
						ease: 'power2.out',
						overwrite: 'auto',
					})
					revealIO.unobserve(e.target)
				}
			},
			{ threshold: 0.15 },
		)
		groups.forEach(g => revealIO.observe(g))

		return () => {
			tl?.kill()
			io?.disconnect()
			revealIO.disconnect()
			document.removeEventListener('visibilitychange', onVis)
			details.forEach(d => d.removeEventListener('toggle', onToggle))
			if (mock) {
				mock.removeEventListener('pointermove', onMove)
				mock.removeEventListener('pointerleave', onLeave)
			}
		}
	}, [])

	return null
}
