import LogoMark from '@/components/LogoMark'
import ThemeToggle from '@/components/ThemeToggle'
import { GUIDE_STEPS } from '@/lib/guide'
import { siteUrl } from '@/lib/site'
import type { Metadata } from 'next'

export const metadata: Metadata = {
	title: 'Как добавить оверлей в OBS — пошаговая инструкция',
	description:
		'Четыре шага: скопировать ссылку оверлея, добавить Browser Source в OBS, вставить URL и выставить размер. Ovrly работает без установки, плагинов и настройки серверов.',
	alternates: { canonical: '/guide' },
	openGraph: {
		type: 'website',
		url: '/guide',
		siteName: 'Ovrly',
		locale: 'ru_RU',
		title: 'Как добавить оверлей в OBS — инструкция Ovrly',
		description:
			'Пошагово: ссылка оверлея → Browser Source в OBS → URL и размер → готово. Без установки и плагинов.',
		images: [
			{
				url: '/og-v2.jpg',
				width: 1200,
				height: 630,
				type: 'image/jpeg',
				alt: 'Ovrly — панель управления оверлеем для OBS',
			},
		],
	},
}

const tips = [
	{
		icon: '📐',
		title: 'Размер — любой.',
		text: '1920×1080 просто удобный старт: OBS сам масштабирует картинку под твой холст.',
	},
	{
		icon: '♻️',
		title: 'Не отставай от сцен.',
		text: 'Включи «Обновить браузер, когда сцена становится активной».',
	},
	{
		icon: '⚡',
		title: 'Правки — на лету.',
		text: 'Меняй элементы в панели, оверлей обновится в эфире сразу.',
	},
	{
		icon: '🔑',
		title: 'Ссылка сломалась?',
		text: 'Сгенерируй новую в кабинете — у модераторов она обновится автоматически.',
	},
] as const

export default function GuidePage() {
	const site = siteUrl()

	const howTo = {
		'@context': 'https://schema.org',
		'@type': 'HowTo',
		name: 'Как добавить оверлей Ovrly в OBS',
		description:
			'Пошаговая инструкция: ссылка оверлея, Browser Source, URL и размер, готово.',
		totalTime: 'PT5M',
		step: GUIDE_STEPS.map((step, index) => ({
			'@type': 'HowToStep',
			position: index + 1,
			name: step.title,
			text: step.text,
			image: `${site}${step.image}`,
		})),
	}
	const breadcrumbs = {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [
			{
				'@type': 'ListItem',
				position: 1,
				name: 'Главная',
				item: site,
			},
			{
				'@type': 'ListItem',
				position: 2,
				name: 'Инструкция',
				item: `${site}/guide`,
			},
		],
	}

	return (
		<main className='landing'>
			<div className='landing-bg' aria-hidden='true'>
				<div className='aurora aurora-a' />
				<div className='aurora aurora-b' />
				<div className='landing-grid' />
			</div>

			<div className='landing-content'>
				<script
					type='application/ld+json'
					dangerouslySetInnerHTML={{ __html: JSON.stringify(howTo) }}
				/>
				<script
					type='application/ld+json'
					dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
				/>

				<header className='site-header'>
					<div className='container header-inner'>
						<a className='brand' href='/'>
							<span className='brand-mark'>
								<LogoMark size={30} />
							</span>
							Ovrly
						</a>

						<nav className='nav desktop-nav' aria-label='Основная навигация'>
							<a href='/#features'>Возможности</a>
							<a href='/#how'>Как работает</a>
							<a href='/#faq'>FAQ</a>
							<a href='/guide' aria-current='page'>
								Инструкция
							</a>
						</nav>

						<div className='header-actions'>
							<ThemeToggle />
							<a
								href='/api/auth/twitch'
								className='btn btn-primary btn-sm header-cta'
							>
								Войти через Twitch
							</a>
							<details className='mobile-nav'>
								<summary aria-label='Открыть меню'>
									<span aria-hidden='true'>☰</span>
								</summary>
								<div className='mobile-nav-panel'>
									<a href='/'> На главную</a>
									<a href='/#features'>Возможности</a>
									<a href='/#faq'>FAQ</a>
									<a href='/guide' aria-current='page'>
										Инструкция
									</a>
									<a href='/api/auth/twitch' className='btn btn-primary'>
										Войти через Twitch
									</a>
								</div>
							</details>
						</div>
					</div>
				</header>

				<section className='container' style={{ padding: '2.6rem 0 2rem' }}>
					<div className='section-head'>
						<span className='kicker'>Инструкция</span>
						<h1 className='hero-title' style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)' }}>
							Как добавить оверлей в OBS
						</h1>
						<p className='section-sub'>
							Четыре шага без установки и плагинов. Нужен только OBS и
							ссылка из кабинета Ovrly.
						</p>
						<div className='hero-actions' style={{ marginTop: '1.2rem' }}>
							<a href='/api/auth/twitch' className='btn btn-primary'>
								Войти через Twitch
							</a>
							<a href='/' className='btn btn-ghost'>
								На главную
							</a>
						</div>
					</div>

					<div className='cabinet-guide-grid'>
						{GUIDE_STEPS.map((step, index) => (
							<article key={step.title} className='glass-card cabinet-guide-card'>
								<div className='cabinet-guide-head'>
									<span className='cabinet-guide-num'>{index + 1}</span>
									<h2 className='cabinet-card-title'>{step.title}</h2>
								</div>
								<p className='cabinet-card-text'>{step.text}</p>
								<div className='cabinet-guide-shot'>
									<img
										src={step.image}
										alt={step.alt}
										width={720}
										height={420}
										loading='lazy'
									/>
								</div>
							</article>
						))}
					</div>

					<div className='glass-card cabinet-guide-tips'>
						<h2 className='cabinet-card-title'>Что ещё стоит знать</h2>
						<ul className='cabinet-tips-list'>
							{tips.map(tip => (
								<li key={tip.title}>
									<span aria-hidden='true'>{tip.icon}</span>
									<p>
										<strong>{tip.title}</strong> {tip.text}
									</p>
								</li>
							))}
						</ul>
					</div>

					<div className='cta-panel' style={{ marginTop: '1.4rem' }}>
						<h2 className='cta-title'>Готов включить оверлей?</h2>
						<p className='cta-sub'>
							Войди через Twitch и собери первый экран за пару минут.
						</p>
						<div className='cta-actions'>
							<a href='/api/auth/twitch' className='btn btn-primary btn-lg'>
								Начать бесплатно
							</a>
							<a href='/#features' className='btn btn-ghost btn-lg'>
								Возможности
							</a>
						</div>
					</div>
				</section>

				<footer className='container site-footer'>
					<span>© 2026 jettle_, nezory_1 · Ovrly</span>
					<div className='footer-links'>
						<a href='/'>Главная</a>
						<a
							href='https://t.me/ovrly_control'
							target='_blank'
							rel='noopener noreferrer'
						>
							Telegram
						</a>
						<a
							href='https://github.com/qmaximp/ovrly'
							target='_blank'
							rel='noopener noreferrer'
						>
							GitHub
						</a>
					</div>
				</footer>
			</div>
		</main>
	)
}
