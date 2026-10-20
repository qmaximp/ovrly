'use client'

import LogoMark from '@/components/LogoMark'
import ThemeToggle from '@/components/ThemeToggle'
import { useCallback, useEffect, useState } from 'react'

function TwitchIcon({ size = 20 }: { size?: number }) {
	return (
		<svg viewBox='0 0 24 24' fill='#fff' width={size} height={size}>
			<path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z' />
		</svg>
	)
}

// аватар участника: картинка из Twitch, а если её нет — кружок с первой буквой ника
function PersonAvatar({
	login,
	avatar,
}: {
	login: string
	avatar?: string | null
}) {
	if (avatar)
		return (
			<img
				src={avatar}
				alt=''
				loading='lazy'
				referrerPolicy='no-referrer'
				className='cabinet-avatar-sm'
			/>
		)
	return (
		<span className='cabinet-avatar-sm cabinet-avatar-initial'>
			{login.slice(0, 1).toUpperCase()}
		</span>
	)
}

function PanelIcon() {
	return (
		<svg
			width='21'
			height='21'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='1.8'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<rect x='3' y='4' width='18' height='13' rx='2' />
			<path d='M8 21h8M12 17v4' />
		</svg>
	)
}

function BroadcastIcon() {
	return (
		<svg
			width='21'
			height='21'
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth='1.8'
			strokeLinecap='round'
			strokeLinejoin='round'
			aria-hidden='true'
		>
			<rect x='3' y='5' width='18' height='14' rx='2' />
			<path d='m10 9 5 3-5 3zM7 2h10' />
		</svg>
	)
}

type InviteStatus = 'pending' | 'accepted'

type Invite = {
	owner: string
	status: InviteStatus
	suspended: boolean
	token: string | null
	avatar?: string | null
}

type Moderator = {
	login: string
	status: InviteStatus
	suspended: boolean
	invitedAt: string
	visitedAt?: string
	acceptedAt?: string
	avatar?: string | null
}

type InvitesPayload = {
	invites: Invite[]
	moderators: Moderator[]
	roomToken: string | null
}

// пошаговая инструкция по добавлению оверлея в OBS: картинки лежат в public/guide
const GUIDE_STEPS = [
	{
		title: 'Скопируй ссылку',
		text: 'Открой вкладку «Мои ссылки» и нажми «Копировать» на карточке «Оверлей для OBS».',
		image: '/guide/step-1-copy.svg',
		alt: 'Карточка оверлея в кабинете с выделенной кнопкой «Копировать»',
	},
	{
		title: 'Добавь Browser Source',
		text: 'В OBS открой панель «Источники», нажми «+» и выбери «Браузер».',
		image: '/guide/step-2-source.svg',
		alt: 'Окно OBS: кнопка плюс в источниках и пункт «Браузер» в меню',
	},
	{
		title: 'Вставь ссылку',
		text: 'Вставь ссылку в поле URL. Ширину и высоту выставь по размеру своего экрана. И включи управление аудио через OBS.',
		image: '/guide/step-3-url.svg?v=2',
		alt: 'Свойства Browser Source: поле URL, ширина и высота',
	},
	{
		title: 'Готово',
		text: 'Нажми «ОК» — оверлей появится на сцене. Двигай его мышью, а содержимое меняй в панели.',
		image: '/guide/step-4-ready.svg',
		alt: 'Оверлей появился на сцене OBS',
	},
] as const

interface CabinetClientProps {
	login: string
	displayName: string
	avatar?: string
	token: string | null
	origin: string
	// после входа по ссылке стримера кабинет открывается сразу на вкладке доступа
	defaultTab?: 'links' | 'access'
	// администратору показываем вход в админ-панель (кнопка только здесь)
	isAdmin?: boolean
}

export default function CabinetClient({
	login,
	displayName,
	avatar,
	token: initialToken,
	origin,
	defaultTab = 'links',
	isAdmin,
}: CabinetClientProps) {
	const [token, setToken] = useState<string | null>(initialToken)
	const [loaded, setLoaded] = useState(false)
	const [copied, setCopied] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	// вкладки кабинета: ссылки / доступ к панели (инвайты) / инструкция
	const [tab, setTab] = useState<'links' | 'access' | 'guide'>(defaultTab)
	const [inv, setInv] = useState<InvitesPayload | null>(null)
	const [invError, setInvError] = useState('')
	const [inviteNick, setInviteNick] = useState('')

	// подтягиваем сохранённые ссылки при загрузке страницы
	useEffect(() => {
		fetch('/api/links')
			.then(r => r.json())
			.then(d => {
				if (d.token) setToken(d.token)
			})
			.catch(() => {})
			.finally(() => setLoaded(true))
	}, [])

	const loadInvites = useCallback(() => {
		setInvError('')
		fetch('/api/invites')
			.then(async r => {
				const d = await r.json()
				if (!r.ok) throw new Error(d?.error || 'Ошибка загрузки')
				setInv(d)
			})
			.catch(e => setInvError(e?.message || 'Не удалось загрузить доступы'))
	}, [])

	useEffect(() => {
		loadInvites()
	}, [loadInvites])

	// живое обновление: статусы инвайтов и модераторов подтягиваются без перезагрузки страницы
	useEffect(() => {
		const t = setInterval(() => {
			if (document.visibilityState === 'visible') loadInvites()
		}, 5000)
		return () => clearInterval(t)
	}, [loadInvites])

	const act = useCallback(
		async (payload: Record<string, string>) => {
			setBusy(true)
			setInvError('')
			try {
				const r = await fetch('/api/invites', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
				const d = await r.json()
				if (!r.ok) throw new Error(d?.error || 'Ошибка')
				loadInvites()
				return true
			} catch (e: any) {
				setInvError(e?.message || 'Ошибка')
				return false
			} finally {
				setBusy(false)
			}
		},
		[loadInvites],
	)

	const doInvite = async () => {
		if (!inviteNick.trim()) return
		const ok = await act({ action: 'invite', login: inviteNick.trim() })
		if (ok) setInviteNick('')
	}

	const generate = async () => {
		setBusy(true)
		try {
			const r = await fetch('/api/links', { method: 'POST' })
			const d = await r.json()
			if (d.token) setToken(d.token)
		} finally {
			setBusy(false)
		}
	}

	const copy = async (text: string, key: string) => {
		try {
			await navigator.clipboard.writeText(text)
			setCopied(key)
			setTimeout(() => setCopied(null), 1500)
		} catch {}
	}

	const links = token
		? {
				panel: `${origin}/panel?room=${token}`,
				overlay: `${origin}/overlay?room=${token}`,
			}
		: null

	const linkBlock = (
		title: string,
		description: string,
		url: string,
		key: string,
		kind: 'panel' | 'overlay',
	) => (
		<article className='glass-card cabinet-link-card'>
			<div className='flex items-start gap-3'>
				<span className='feature-icon cabinet-link-icon'>
					{kind === 'panel' ? <PanelIcon /> : <BroadcastIcon />}
				</span>
				<div className='min-w-0'>
					<h3 className='cabinet-card-title'>{title}</h3>
					<p className='cabinet-card-text'>{description}</p>
				</div>
			</div>
			<div className='cabinet-url'>{url}</div>
			<div className='flex flex-wrap gap-2'>
				<a
					href={url}
					target='_blank'
					rel='noopener noreferrer'
					className='btn btn-primary btn-sm'
				>
					Перейти ↗
				</a>
				<button onClick={() => copy(url, key)} className='btn btn-ghost btn-sm'>
					{copied === key ? 'Скопировано ✓' : 'Копировать'}
				</button>
			</div>
		</article>
	)

	const tabBtn = (id: 'links' | 'access' | 'guide', label: string) => (
		<button
			onClick={() => setTab(id)}
			className={`cabinet-tab ${tab === id ? 'is-active' : ''}`}
		>
			{label}
		</button>
	)

	const statusCls = (m: Moderator) =>
		m.status === 'pending'
			? 'text-amber-400'
			: m.suspended
				? 'text-red-400'
				: 'text-green-400'

	const statusText = (m: Moderator) =>
		m.status === 'pending'
			? m.visitedAt
				? 'Ждёт подтверждения'
				: 'Приглашён (ещё не заходил)'
			: m.suspended
				? 'Отключён временно'
				: 'Доступ открыт'

	return (
		<main className='landing cabinet-page'>
			<div className='landing-bg' aria-hidden='true'>
				<div className='aurora aurora-a' />
				<div className='aurora aurora-b' />
				<div className='landing-grid' />
			</div>
			<div className='landing-content'>
				<header className='site-header'>
					<div className='container header-inner'>
						<a className='brand' href='/'>
							<span className='brand-mark'>
								<LogoMark size={30} />
							</span>
							Ovrly
						</a>
						<div className='header-actions'>
							<span className='cabinet-header-user'>
								{avatar ? (
									<img src={avatar} alt='' className='cabinet-avatar-sm' />
								) : (
									<span className='cabinet-avatar-sm cabinet-avatar-fallback'>
										<TwitchIcon size={15} />
									</span>
								)}
								<span className='hidden sm:inline'>{displayName}</span>
							</span>
							<ThemeToggle />
							<a href='/api/auth/logout' className='btn btn-sm cabinet-logout'>
								Выйти
							</a>
						</div>
					</div>
				</header>

				<div className='container cabinet-body'>
					<section className='cabinet-hero'>
						<div>
							<span className='eyebrow'>
								<span className='eyebrow-dot' /> личный кабинет
							</span>
							<h1 className='cabinet-title'>
								Личный <span className='accent'>кабинет</span>
							</h1>
							<p className='cabinet-sub'>
								Ссылки, доступы и команда — всё для твоего эфира в одном месте.
							</p>
						</div>
						<aside className='cabinet-account'>
							<span className='cabinet-account-label'>Аккаунт Twitch</span>
							<div className='cabinet-account-row'>
								<span className='cabinet-avatar'>
									{avatar ? (
										<img src={avatar} alt='' />
									) : (
										<TwitchIcon size={22} />
									)}
								</span>
								<div className='min-w-0'>
									<p className='cabinet-account-name'>{displayName}</p>
									<p className='cabinet-account-login'>@{login}</p>
								</div>
							</div>
							<a
								href={`https://www.twitch.tv/${login}`}
								target='_blank'
								rel='noopener noreferrer'
								className='btn btn-ghost btn-sm w-full'
							>
								Открыть Twitch ↗
							</a>
						</aside>
					</section>

					<nav className='cabinet-tabs'>
						{tabBtn('links', 'Мои ссылки')}
						{tabBtn('access', 'Доступ к панели')}
						{tabBtn('guide', 'Как настроить')}
						{isAdmin && (
							<a
								href='/admin'
								target='_blank'
								rel='noopener noreferrer'
								title='Админ-панель откроется отдельной вкладкой'
								className='btn btn-primary btn-sm cabinet-admin-link'
							>
								⚙ Админ-панель
							</a>
						)}
					</nav>

					{tab === 'links' && (
						<section className='cabinet-section'>
							{!loaded ? (
								<p className='cabinet-muted'>Загружаю ссылки…</p>
							) : !links ? (
								<div className='glass-card cabinet-empty'>
									<div className='feature-icon'>
										<PanelIcon />
									</div>
									<h2 className='cabinet-section-title'>Ссылок пока нет</h2>
									<p className='cabinet-muted'>
										Сгенерируйте ссылки — панель и оверлей будут привязаны к
										аккаунту {login}.
									</p>
									<button
										onClick={generate}
										disabled={busy}
										className='btn btn-primary'
									>
										{busy ? 'Генерация…' : 'Сгенерировать ссылки'}
									</button>
								</div>
							) : (
								<>
									<p className='cabinet-note'>
										Ссылки привязаны к аккаунту <span>{login}</span>.
									</p>
									<div className='cabinet-links-grid'>
										{linkBlock(
											'Панель для модераторов',
											'Управление оверлеем и элементами',
											links.panel,
											'panel',
											'panel',
										)}
										{linkBlock(
											'Оверлей для OBS',
											'Browser Source',
											links.overlay,
											'overlay',
											'overlay',
										)}
									</div>
									<button
										onClick={generate}
										disabled={busy}
										className='cabinet-regenerate'
									>
										{busy
											? 'Генерация…'
											: 'Сгенерировать заново (старые ссылки перестанут работать, ссылки у модераторов обновятся автоматически)'}
									</button>
								</>
							)}
						</section>
					)}

					{tab === 'access' && (
						<section className='cabinet-section'>
							<div className='cabinet-section-head'>
								<div>
									<span className='kicker'>Команда</span>
									<h2 className='cabinet-section-title'>Доступ к панели</h2>
								</div>
								<p className='cabinet-muted'>
									Приглашайте модераторов по Twitch-нику — без паролей и лишних
									аккаунтов.
								</p>
							</div>
							{invError && <p className='alert'>{invError}</p>}
							<div className='cabinet-access-grid'>
								<div className='glass-card cabinet-access-card'>
									<h3 className='cabinet-card-title'>Приглашения</h3>
									<p className='cabinet-card-text'>
										Приглашения от других стримеров.
									</p>
									{!inv || inv.invites.length === 0 ? (
										<p className='cabinet-muted mt-4'>
											Пока нет приглашений. Стример выдаёт доступ по нику
											Twitch.
										</p>
									) : (
										<div className='mt-3 space-y-2'>
											{inv.invites.map(i => (
												<div key={i.owner} className='cabinet-invite-card'>
													<div className='cabinet-person flex min-w-0 flex-1 items-center gap-2.5'>
														<PersonAvatar login={i.owner} avatar={i.avatar} />
														<div className='min-w-0'>
															<a
																href={`https://www.twitch.tv/${i.owner}`}
																target='_blank'
																rel='noopener noreferrer'
																className='cabinet-mod-name'
															>
																{i.owner} ↗
															</a>
															<p
																className={`cabinet-mod-status ${i.status === 'pending' ? 'text-amber-400' : i.suspended ? 'text-red-400' : 'text-green-400'}`}
															>
																{i.status === 'pending'
																	? 'Ждёт подтверждения'
																	: i.suspended
																		? 'Доступ временно отключён'
																		: 'Доступ открыт'}
															</p>
														</div>
													</div>
													<div className='cabinet-card-actions flex flex-wrap gap-1.5'>
														{i.status === 'pending' && (
															<button
																onClick={() =>
																	act({ action: 'accept', owner: i.owner })
																}
																disabled={busy}
																className='btn btn-primary btn-sm'
															>
																Принять
															</button>
														)}
														{i.status === 'accepted' &&
															!i.suspended &&
															i.token && (
																<a
																	href={`${origin}/panel?room=${i.token}`}
																	target='_blank'
																	rel='noopener noreferrer'
																	className='btn btn-ghost btn-sm'
																>
																	Открыть панель ↗
																</a>
															)}
														<button
															onClick={() =>
																act({ action: 'decline', owner: i.owner })
															}
															disabled={busy}
															className='btn btn-danger btn-sm'
														>
															Отклонить
														</button>
													</div>
												</div>
											))}
										</div>
									)}
								</div>

								<div className='glass-card cabinet-access-card'>
									<h3 className='cabinet-card-title'>Модераторы моей панели</h3>
									<p className='cabinet-card-text'>
										Люди, которым можно доверить оверлей.
									</p>
									{!inv?.roomToken ? (
										<p className='cabinet-muted mt-4'>
											Сначала сгенерируйте ссылки во вкладке «Мои ссылки».
										</p>
									) : (
										<>
											<div className='cabinet-invite-row'>
												<input
													value={inviteNick}
													onChange={e => setInviteNick(e.target.value)}
													onKeyDown={e => {
														if (e.key === 'Enter') doInvite()
													}}
													placeholder='Ник Twitch (например, jettle_)'
													className='cabinet-input'
												/>
												<button
													onClick={doInvite}
													disabled={busy || !inviteNick.trim()}
													className='btn btn-primary'
												>
													Пригласить
												</button>
											</div>
											<div className='mt-3 space-y-2'>
												{inv.moderators.length === 0 ? (
													<p className='cabinet-muted'>
														Модераторов ещё нет. Пригласите по нику.
													</p>
												) : (
													inv.moderators.map(m => (
														<div key={m.login} className='cabinet-mod-row'>
															<PersonAvatar login={m.login} avatar={m.avatar} />
															<div className='cabinet-person min-w-0 flex-1'>
																<a
																	href={`https://www.twitch.tv/${m.login}`}
																	target='_blank'
																	rel='noopener noreferrer'
																	className='cabinet-mod-name'
																>
																	{m.login} ↗
																</a>
																<p
																	className={`cabinet-mod-status ${statusCls(m)}`}
																>
																	{statusText(m)}
																</p>
															</div>
															<div className='cabinet-card-actions flex flex-wrap gap-1.5 justify-end'>
																{m.status === 'accepted' && (
																	<button
																		onClick={() =>
																			act({
																				action: m.suspended
																					? 'resume'
																					: 'suspend',
																				login: m.login,
																			})
																		}
																		disabled={busy}
																		className='btn btn-ghost btn-sm'
																	>
																		{m.suspended ? 'Включить' : 'Отключить'}
																	</button>
																)}
																<button
																	onClick={() =>
																		act({ action: 'revoke', login: m.login })
																	}
																	disabled={busy}
																	className='btn btn-danger btn-sm'
																>
																	Забрать
																</button>
															</div>
														</div>
													))
												)}
											</div>
										</>
									)}
								</div>
							</div>
						</section>
					)}
					{tab === 'guide' && (
						<section className='cabinet-section'>
							<div className='cabinet-section-head'>
								<div>
									<span className='kicker'>Инструкция</span>
									<h2 className='cabinet-section-title'>
										Как настроить оверлей
									</h2>
								</div>
								<p className='cabinet-muted'>
									Четыре шага — от ссылки в кабинете до оверлея на сцене.
								</p>
							</div>

							{loaded && !links && (
								<div className='glass-card cabinet-guide-callout'>
									<span className='cabinet-guide-callout-icon'>🔗</span>
									<div className='min-w-0'>
										<p className='cabinet-card-title'>Сначала нужна ссылка</p>
										<p className='cabinet-card-text'>
											Сгенерируй её во вкладке «Мои ссылки» — без неё оверлей
											некуда вставлять.
										</p>
									</div>
									<button
										onClick={() => setTab('links')}
										className='btn btn-primary btn-sm'
									>
										К ссылкам
									</button>
								</div>
							)}

							<div className='cabinet-guide-grid'>
								{GUIDE_STEPS.map((s, i) => (
									<article
										key={s.title}
										className='glass-card cabinet-guide-card'
									>
										<div className='cabinet-guide-head'>
											<span className='cabinet-guide-num'>{i + 1}</span>
											<h3 className='cabinet-card-title'>{s.title}</h3>
										</div>
										<p className='cabinet-card-text'>{s.text}</p>
										<div className='cabinet-guide-shot'>
											<img
												src={s.image}
												alt={s.alt}
												width={720}
												height={420}
												loading='lazy'
											/>
										</div>
									</article>
								))}
							</div>

							<div className='glass-card cabinet-guide-tips'>
								<h3 className='cabinet-card-title'>Что ещё стоит знать</h3>
								<ul className='cabinet-tips-list'>
									<li>
										<span aria-hidden='true'>📐</span>
										<p>
											<strong>Размер — любой.</strong> 1920×1080 просто удобный
											старт: OBS сам масштабирует картинку под твой холст.
										</p>
									</li>
									<li>
										<span aria-hidden='true'>♻️</span>
										<p>
											<strong>Не отставай от сцен.</strong> Включи «Обновить
											браузер, когда сцена становится активной».
										</p>
									</li>
									<li>
										<span aria-hidden='true'>⚡</span>
										<p>
											<strong>Правки — на лету.</strong> Меняй элементы в
											панели, оверлей обновится в эфире сразу.
										</p>
									</li>
									<li>
										<span aria-hidden='true'>🔑</span>
										<p>
											<strong>Ссылка сломалась?</strong> Сгенерируй новую в
											кабинете — у модераторов она обновится автоматически.
										</p>
									</li>
								</ul>
								<button
									onClick={() => setTab('links')}
									className='btn btn-ghost btn-sm cabinet-guide-back'
								>
									← Мои ссылки
								</button>
							</div>
						</section>
					)}
				</div>

				<footer className='container site-footer cabinet-footer'>
					<div className='flex items-center gap-2 flex-wrap'>
						<a
							href='https://dalink.to/jettle_'
							target='_blank'
							rel='noopener noreferrer'
							className='btn btn-ghost btn-sm'
						>
							💜 Поддержать проект
						</a>
						<span>Ovrly развивается бесплатно — поддержка очень помогает</span>
					</div>
					<div className='footer-links'>
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
						<span>© 2026 jettle_, nezory_1 · Версия 2.0</span>
					</div>
				</footer>
			</div>
		</main>
	)
}
