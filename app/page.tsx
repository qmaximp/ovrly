import LogoMark from '@/components/LogoMark'
import ThemeToggle from '@/components/ThemeToggle'
import { verifySession } from '@/lib/session'
import { siteUrl } from '@/lib/site'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
	alternates: { canonical: '/' },
}

const iconPaths = {
	move: 'M5 3l7 17 2-6 6-2z',
	media: 'M3 5h18v14H3z M10 9l6 3-6 3z',
	timer: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8v5l3 2',
	obs: 'M3 5h18v12H3z M8 21h8 M12 17v4',
	users:
		'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
	theme: 'M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z',
} as const

const features = [
	{
		icon: 'move',
		title: 'Живое редактирование',
		text: 'Перетаскивай, меняй размер и поворачивай элементы прямо во время эфира. Модераторы видят изменения сразу.',
		badge: 'real-time',
	},
	{
		icon: 'media',
		title: 'Любое медиа',
		text: 'Картинки, видео, GIF, YouTube, Twitch, сайты и смайлики — всё на одном холсте, без переключения окон.',
		badge: 'медиа',
	},
	{
		icon: 'timer',
		title: 'Таймеры со звуком',
		text: 'Обратный отсчёт с собственным звуком, точной обрезкой до 10 секунд и отдельной громкостью.',
		badge: 'эфир',
	},
	{
		icon: 'obs',
		title: 'OBS под рукой',
		text: 'Сцены и источники через OBS WebSocket — включай и выключай прямо из панели, не переключая окна.',
		badge: 'OBS',
	},
	{
		icon: 'users',
		title: 'Доступы по нику',
		text: 'Приглашай модераторов по Twitch-нику и управляй правами без паролей и лишних аккаунтов.',
		badge: 'команда',
	},
	{
		icon: 'theme',
		title: 'Темы и мобильность',
		text: 'Тёмная и светлая темы, аккуратная работа на телефоне и планшете — панель всегда под рукой.',
		badge: 'удобно',
	},
] as const

const steps = [
	{
		title: 'Войди через Twitch',
		text: 'Никаких регистраций и паролей — только твой Twitch-аккаунт.',
	},
	{
		title: 'Собери оверлей',
		text: 'Добавь картинки, видео, текст и таймеры. Перетаскивай и настраивай прямо в панели.',
	},
	{
		title: 'Вставь в OBS',
		text: 'Добавь ссылку оверлея как Browser Source — размер любой.',
	},
] as const

const faqs = [
	{
		q: 'Это бесплатно?',
		a: 'Да. Ovrly — open-source проект под AGPL-3.0. Вход через Twitch, без подписки и скрытых платежей.',
	},
	{
		q: 'Нужно ли что-то устанавливать?',
		a: 'Нет. Панель работает в браузере, а оверлей добавляется в OBS как Browser Source. Никаких плагинов и установщиков.',
	},
	{
		q: 'Как дать доступ модератору?',
		a: 'В кабинете пригласи модератора по его Twitch-нику. Он увидит только те комнаты, к которым получил доступ, и сможет помогать с эфиром.',
	},
	{
		q: 'Работает ли на телефоне?',
		a: 'Да, панель адаптирована под телефон и планшет. В портретной ориентации она попросит повернуть экран, чтобы холсту было достаточно места.',
	},
] as const

function Icon({ name }: { name: keyof typeof iconPaths }) {
	return (
		<svg
			width='22'
			height='22'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='1.8'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<path d={iconPaths[name]} />
		</svg>
	)
}

function Check() {
	return (
		<svg
			width='13'
			height='13'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='2.4'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<path d='m5 12 4 4L19 6' />
		</svg>
	)
}

function TwitchIcon({ size = 18 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='currentColor'
			aria-hidden='true'
		>
			<path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z' />
		</svg>
	)
}

function MenuIcon() {
	return (
		<svg
			width='18'
			height='18'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='1.9'
			strokeLinecap='round'
			aria-hidden='true'
		>
			<path d='M4 7h16M4 12h16M4 17h16' />
		</svg>
	)
}

// Next 16: cookies() и searchParams асинхронные — их нужно дожидаться
export default async function Home({
	searchParams,
}: {
	searchParams?: Promise<{ error?: string }>
}) {
	const session = verifySession((await cookies()).get('sc_session')?.value)
	if (session) redirect('/cabinet')
	const error = (await searchParams)?.error

	// структурированные данные для поиска: что это за приложение
	const site = siteUrl()
	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'SoftwareApplication',
		name: 'Ovrly',
		url: site,
		applicationCategory: 'MultimediaApplication',
		operatingSystem: 'Windows, macOS, Linux (OBS Studio)',
		inLanguage: 'ru',
		description:
			'Панель управления оверлеем OBS: картинки, видео, сайты, YouTube и Twitch, текст и таймеры с перетаскиванием в реальном времени и доступами для модераторов.',
		softwareVersion: '1.6',
		isAccessibleForFree: true,
		license: 'https://github.com/qmaximp/ovrly/blob/main/LICENSE',
		image: `${site}/og-v2.jpg`,
		screenshot: `${site}/og-v2.jpg`,
		featureList: features.map(f => f.title),
		dateModified: '2026-10-25',
		author: [
			{
				'@type': 'Person',
				name: 'jettle_',
				url: 'https://www.twitch.tv/jettle_',
			},
			{
				'@type': 'Person',
				name: 'nezory_1',
				url: 'https://www.twitch.tv/nezory_1',
			},
		],
		publisher: {
			'@type': 'Organization',
			name: 'Ovrly',
			url: site,
			logo: `${site}/icon-512.png`,
			sameAs: [
				'https://github.com/qmaximp/ovrly',
				'https://t.me/ovrly_control',
			],
		},
		sameAs: ['https://github.com/qmaximp/ovrly', 'https://t.me/ovrly_control'],
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
	}
	// FAQPage помогает Яндексу и Google показать блок «Вопросы и ответы»
	const faqLd = {
		'@context': 'https://schema.org',
		'@type': 'FAQPage',
		mainEntity: faqs.map(item => ({
			'@type': 'Question',
			name: item.q,
			acceptedAnswer: { '@type': 'Answer', text: item.a },
		})),
	}

	return (
		<main className='landing'>
			<div className='landing-bg' aria-hidden='true'>
				<div className='aurora aurora-a' />
				<div className='aurora aurora-b' />
				<div className='aurora aurora-c' />
				<div className='landing-grid' />
			</div>

			<div className='landing-content'>
				<script
					type='application/ld+json'
					dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
				/>
				<script
					type='application/ld+json'
					dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
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
							<a href='#features'>Возможности</a>
							<a href='#how'>Как работает</a>
							<a href='#faq'>FAQ</a>
							<a href='/guide'>Инструкция</a>
							<a
								href='https://github.com/qmaximp/ovrly'
								target='_blank'
								rel='noopener noreferrer'
							>
								GitHub
							</a>
						</nav>

						<div className='header-actions'>
							<ThemeToggle />
							<a
								href='/api/auth/twitch'
								className='btn btn-primary btn-sm header-cta'
							>
								<TwitchIcon size={16} />
								Войти
							</a>
							<details className='mobile-nav'>
								<summary aria-label='Открыть меню'>
									<MenuIcon />
								</summary>
								<div className='mobile-nav-panel'>
									<a href='#features'>Возможности</a>
									<a href='#how'>Как работает</a>
									<a href='#faq'>FAQ</a>
									<a href='/guide'>Инструкция</a>
									<a
										href='https://github.com/qmaximp/ovrly'
										target='_blank'
										rel='noopener noreferrer'
									>
										GitHub
									</a>
									<a href='/api/auth/twitch' className='btn btn-primary'>
										<TwitchIcon size={16} />
										Войти через Twitch
									</a>
									<a
										href='https://dalink.to/jettle_'
										target='_blank'
										rel='noopener noreferrer'
										className='btn btn-ghost'
									>
										💜 Поддержать проект
									</a>
								</div>
							</details>
						</div>
					</div>
				</header>

				<section className='container hero'>
					<div className='hero-copy'>
						<span className='eyebrow reveal'>
							<span className='eyebrow-dot' />
							Панель управления оверлеем для OBS
						</span>
						<h1 className='hero-title reveal d1'>
							Эфир под контролем.
							<br />
							<span className='accent'>Без лишних кликов.</span>
						</h1>
						<p className='hero-sub reveal d2'>
							Картинки, видео, GIF, YouTube, Twitch, сайты, текст и таймеры — на
							одном холсте. Перетаскивай, меняй и управляй прямо во время
							стрима.
						</p>
						<div className='hero-actions reveal d3'>
							<a href='/api/auth/twitch' className='btn btn-primary btn-lg'>
								<TwitchIcon size={19} />
								Войти через Twitch
							</a>
							<a href='#features' className='btn btn-ghost btn-lg'>
								Посмотреть возможности
							</a>
						</div>
						<div className='hero-meta reveal d4'>
							<span>
								<Check /> Бесплатно
							</span>
							<span>
								<Check /> Без установки
							</span>
							<span>
								<Check /> Работает в OBS Browser Source
							</span>
						</div>
						{error && (
							<p className='alert reveal d5'>
								{error === 'config'
									? 'Вход не настроен: заполните TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET в .env.local (см. README).'
									: 'Не удалось войти через Twitch. Попробуйте ещё раз.'}
							</p>
						)}
					</div>

					<div className='hero-visual reveal d2' aria-hidden='true'>
						<div className='mock'>
							<div className='mock-top'>
								<span className='mock-dot' />
								<span className='mock-dot' />
								<span className='mock-dot' />
								<span className='mock-title'>Ovrly · panel</span>
							</div>
							<div className='mock-body'>
								<div className='mock-sidebar'>
									<span className='mock-line w45' />
									<span className='mock-pill' />
									<span className='mock-pill' />
									<span className='mock-pill' />
									<span className='mock-line w80' />
									<span className='mock-line w60' />
									<span className='mock-line w45' />
								</div>
								<div className='mock-canvas'>
									<div className='mock-grid-lines' />
									<div className='mock-card mock-card-a' />
									<div className='mock-card mock-card-b' />
									<div className='mock-card mock-card-c' />
									<span className='mock-chip'>⏱ 05:00</span>
									<svg
										className='mock-cursor'
										viewBox='0 0 24 28'
										fill='currentColor'
									>
										<path d='M4 2l14.5 10.6-6.8.7L14.6 21l-3.4 1.4-2.9-7.7L4 18.4z' />
									</svg>
								</div>
							</div>
						</div>
					</div>
				</section>

				<section id='features' className='container section'>
					<div className='section-head'>
						<span className='kicker'>Возможности</span>
						<h2 className='section-title'>Всё, что нужно для живого эфира</h2>
						<p className='section-sub'>
							Один холст вместо десятка окон. Настраивай сцену, подключай медиа
							и управляй источниками OBS, не отрываясь от стрима.
						</p>
					</div>
					<div className='features-grid'>
						{features.map((f, i) => (
							<article
								key={f.title}
								className={`feature-card reveal d${(i % 6) + 1}`}
							>
								<div className='feature-icon'>
									<Icon name={f.icon} />
								</div>
								<h3 className='feature-title'>{f.title}</h3>
								<p className='feature-text'>{f.text}</p>
								<span className='feature-badge'>{f.badge}</span>
							</article>
						))}
					</div>
				</section>

				<section id='how' className='container section'>
					<div className='section-head'>
						<span className='kicker'>Как это работает</span>
						<h2 className='section-title'>От входа до эфира — три шага</h2>
						<p className='section-sub'>
							Без установки, настройки серверов и сложных инструкций. Всё
							делается в браузере.
						</p>
					</div>
					<div className='steps'>
						{steps.map((s, i) => (
							<article key={s.title} className={`step reveal d${i + 1}`}>
								<div className='step-num'>{i + 1}</div>
								<h3 className='step-title'>{s.title}</h3>
								<p className='step-text'>{s.text}</p>
								<span className='step-line' />
							</article>
						))}
					</div>
					<a
						href='/guide'
						className='btn btn-ghost btn-sm'
						style={{ marginTop: '1.2rem' }}
					>
						Подробная инструкция для OBS →
					</a>
				</section>

				<section className='container section'>
					<div className='showcase-strip reveal'>
						<div className='showcase-item'>
							<span className='showcase-value'>любой размер</span>
							<span className='showcase-label'>холст оверлея</span>
						</div>
						<div className='showcase-item'>
							<span className='showcase-value'>Browser Source</span>
							<span className='showcase-label'>подключение к OBS</span>
						</div>
						<div className='showcase-item'>
							<span className='showcase-value'>real-time</span>
							<span className='showcase-label'>синхронизация панели</span>
						</div>
						<div className='showcase-item'>
							<span className='showcase-value'>0 установок</span>
							<span className='showcase-label'>только браузер</span>
						</div>
					</div>
				</section>

				<section id='faq' className='container section'>
					<div className='section-head'>
						<span className='kicker'>FAQ</span>
						<h2 className='section-title'>Коротко о главном</h2>
					</div>
					<div className='faq'>
						{faqs.map(f => (
							<details key={f.q}>
								<summary>
									<span>{f.q}</span>
									<span className='faq-icon' aria-hidden='true'>
										+
									</span>
								</summary>
								<p className='faq-answer'>{f.a}</p>
							</details>
						))}
					</div>
				</section>

				<section className='container section'>
					<div className='cta-panel reveal'>
						<h2 className='cta-title'>Готов включить оверлей?</h2>
						<p className='cta-sub'>
							Войди через Twitch и собери первый экран за пару минут. Бесплатно,
							без установки, с доступом для модераторов.
						</p>
						<div className='cta-actions'>
							<a href='/api/auth/twitch' className='btn btn-primary btn-lg'>
								<TwitchIcon size={19} />
								Начать бесплатно
							</a>
							<a
								href='https://dalink.to/jettle_'
								target='_blank'
								rel='noopener noreferrer'
								className='btn btn-ghost btn-lg'
							>
								💜 Поддержать проект
							</a>
						</div>
					</div>
				</section>

				<footer className='container site-footer'>
					<span>© 2026 jettle_, nezory_1 · Версия 2.1</span>
					<div className='footer-links'>
						<a href='/guide'>Инструкция</a>
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
						<a
							href='https://github.com/qmaximp/ovrly/blob/main/LICENSE'
							target='_blank'
							rel='noopener noreferrer'
							title='GNU Affero General Public License v3.0'
						>
							AGPL-3.0
						</a>
					</div>
				</footer>
			</div>
		</main>
	)
}
