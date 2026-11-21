'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { checkPassword } from '@/lib/passwordRules'

// Модальное окно входа и регистрации по почте.
//
// Вход: почта или Twitch-логин (если аккаунт привязан) + пароль. Капча
// показывается на регистрации всегда, а на входе — после нескольких неудачных
// попыток (сервер отвечает { captcha: true }).
//
// Регистрация: почта → код из письма → пароль и подтверждение. Галочки
// согласия не отмечены заранее: пользователь должен поставить их сам.

type Mode = 'login' | 'register' | 'reset'
type Step = 'identify' | 'code'

type Captcha = { token: string; svg: string }

export default function AuthDialog({
	open,
	onClose,
	next = '/cabinet',
	initialMode = 'login',
}: {
	open: boolean
	onClose: () => void
	next?: string
	initialMode?: Mode
}) {
	const [mode, setMode] = useState<Mode>(initialMode)
	const [step, setStep] = useState<Step>('identify')
	const [identifier, setIdentifier] = useState('')
	const [password, setPassword] = useState('')
	const [email, setEmail] = useState('')
	const [code, setCode] = useState('')
	const [password2, setPassword2] = useState('')
	const [terms, setTerms] = useState(false)
	const [pd, setPd] = useState(false)
	const [captcha, setCaptcha] = useState<Captcha | null>(null)
	const [captchaAnswer, setCaptchaAnswer] = useState('')
	const [captchaRequired, setCaptchaRequired] = useState(false)
	const [error, setError] = useState('')
	const [hint, setHint] = useState('')
	const [busy, setBusy] = useState(false)
	const [devCode, setDevCode] = useState('')
	const dialogRef = useRef<HTMLDivElement>(null)
	// Портал монтируем только на клиенте: так разметка сервера и первый рендер
	// клиента совпадают, а модалка гарантированно уходит в <body>.
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])

	const loadCaptcha = useCallback(async () => {
		try {
			const r = await fetch('/api/auth/captcha', { cache: 'no-store' })
			if (!r.ok) return
			const d = await r.json()
			if (d?.token && d?.svg) {
				setCaptcha({ token: d.token, svg: d.svg })
				setCaptchaAnswer('')
			}
		} catch {
			// капча не загрузилась — сервер всё равно проверит ответ
		}
	}, [])

	// при открытии: сбрасываем ошибки, ставим фокус на диалог
	useEffect(() => {
		if (!open) return
		setError('')
		setHint('')
		setBusy(false)
		setMode(initialMode)
		setStep('identify')
		setTerms(false)
		setPd(false)
		setPassword('')
		setPassword2('')
		setCode('')
		setDevCode('')
		document.body.style.overflow = 'hidden'
		dialogRef.current?.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKey)
		return () => {
			document.body.style.overflow = ''
			window.removeEventListener('keydown', onKey)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, initialMode])

	useEffect(() => {
		if (!open) return
		if (mode === 'register' || mode === 'reset' || captchaRequired) {
			void loadCaptcha()
		}
	}, [open, mode, captchaRequired, loadCaptcha])

	if (!open || !mounted) return null

	const switchMode = (m: Mode) => {
		setMode(m)
		setStep('identify')
		setError('')
		setHint('')
		setDevCode('')
		setCaptchaAnswer('')
	}

	const post = async (url: string, body: unknown) => {
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		})
		let d: any = {}
		try {
			d = await r.json()
		} catch {
			// пустой ответ
		}
		return { ok: r.ok, status: r.status, d }
	}

	const finish = (path?: string) => {
		const target = path && path.startsWith('/') ? path : next
		window.location.assign(target)
	}

	const submitLogin = async (e: FormEvent) => {
		e.preventDefault()
		setError('')
		if (!identifier.trim() || !password) {
			setError('Заполните логин и пароль.')
			return
		}
		if (captchaRequired && !captchaAnswer.trim()) {
			setError('Введите ответ с картинки.')
			return
		}
		setBusy(true)
		try {
			const { ok, d } = await post('/api/auth/login', {
				identifier: identifier.trim(),
				password,
				captchaToken: captcha?.token,
				captchaAnswer: captchaAnswer.trim(),
				next,
			})
			if (ok) {
				finish(d.next)
				return
			}
			if (d?.captcha) {
				setCaptchaRequired(true)
				void loadCaptcha()
			}
			setError(d?.error || 'Не удалось войти.')
		} catch {
			setError('Сеть недоступна. Попробуйте ещё раз.')
		} finally {
			setBusy(false)
		}
	}

	const submitRegisterStart = async (e: FormEvent) => {
		e.preventDefault()
		setError('')
		if (!email.trim()) {
			setError('Укажите почту.')
			return
		}
		if (!terms || !pd) {
			setHint('Отметьте оба пункта, чтобы продолжить.')
			return
		}
		if (!captchaAnswer.trim()) {
			setError('Введите ответ с картинки.')
			return
		}
		setBusy(true)
		try {
			const { ok, d } = await post('/api/auth/register/start', {
				email: email.trim(),
				captchaToken: captcha?.token,
				captchaAnswer: captchaAnswer.trim(),
				consent: true,
			})
			if (!ok) {
				setError(d?.error || 'Не удалось отправить код.')
				void loadCaptcha()
				return
			}
			if (d?.devCode) setDevCode(String(d.devCode))
			setStep('code')
			setHint(
				d?.existing
					? 'С этой почтой уже есть аккаунт. Подтвердите код — и мы пустим вас в него (пароль обновится, если введёте новый).'
					: '',
			)
		} catch {
			setError('Сеть недоступна. Попробуйте ещё раз.')
		} finally {
			setBusy(false)
		}
	}

	const submitRegisterVerify = async (e: FormEvent) => {
		e.preventDefault()
		setError('')
		if (!/^\d{6}$/.test(code.trim())) {
			setError('Код — шесть цифр из письма.')
			return
		}
		if (password !== password2) {
			setError('Пароли не совпадают.')
			return
		}
		const check = checkPassword(password, email)
		if (!check.ok) {
			setError(check.issues[0] || 'Пароль слишком слабый.')
			return
		}
		setBusy(true)
		try {
			const { ok, d } = await post('/api/auth/register/verify', {
				email: email.trim(),
				code: code.trim(),
				password,
				passwordConfirm: password2,
				consent: true,
			})
			if (ok) {
				finish(d.next)
				return
			}
			if (d?.existing) {
				// Гонка: аккаунт создали между шагами — предлагаем войти.
				setError(d.error || 'Аккаунт с этой почтой уже есть.')
				return
			}
			setError(d?.error || 'Не удалось создать аккаунт.')
		} catch {
			setError('Сеть недоступна. Попробуйте ещё раз.')
		} finally {
			setBusy(false)
		}
	}

	// Восстановление пароля: шаг 1 — письмо с кодом, шаг 2 — код и новый пароль.
	const startReset = () => {
		switchMode('reset')
		setIdentifier(email)
		setPassword('')
		setPassword2('')
		setCode('')
		void loadCaptcha()
	}

	const submitResetStart = async (e: FormEvent) => {
		e.preventDefault()
		setError('')
		if (!email.trim()) {
			setError('Укажите почту.')
			return
		}
		if (!captchaAnswer.trim()) {
			setError('Введите ответ с картинки.')
			return
		}
		setBusy(true)
		try {
			const { ok, d } = await post('/api/auth/reset/start', {
				email: email.trim(),
				captchaToken: captcha?.token,
				captchaAnswer: captchaAnswer.trim(),
			})
			if (!ok) {
				setError(d?.error || 'Не удалось отправить письмо.')
				void loadCaptcha()
				return
			}
			setStep('code')
			setHint('')
		} catch {
			setError('Сеть недоступна. Попробуйте ещё раз.')
		} finally {
			setBusy(false)
		}
	}

	const submitResetVerify = async (e: FormEvent) => {
		e.preventDefault()
		setError('')
		if (!/^\d{6}$/.test(code.trim())) {
			setError('Код — шесть цифр из письма.')
			return
		}
		if (password !== password2) {
			setError('Пароли не совпадают.')
			return
		}
		const check = checkPassword(password, email)
		if (!check.ok) {
			setError(check.issues[0] || 'Пароль слишком слабый.')
			return
		}
		setBusy(true)
		try {
			const { ok, d } = await post('/api/auth/reset/verify', {
				email: email.trim(),
				code: code.trim(),
				password,
				next,
			})
			if (ok) {
				finish(d.next)
				return
			}
			setError(d?.error || 'Не удалось изменить пароль.')
		} catch {
			setError('Сеть недоступна. Попробуйте ещё раз.')
		} finally {
			setBusy(false)
		}
	}

	const strength = checkPassword(password, email)
	const strengthCls = ['is-0', 'is-1', 'is-2', 'is-3', 'is-4'][strength.score]

	// Критичная раскладка задаётся инлайном, а не только классами: если
	// stylesheet не успел примениться (hot reload, кэш), модалка всё равно
	// остаётся поверх страницы, а не «полоской» в потоке хиро-кнопок.
	const overlayStyle: CSSProperties = {
		position: 'fixed',
		inset: 0,
		zIndex: 60,
		display: 'grid',
		placeItems: 'center',
		padding: '1rem',
		overflowY: 'auto',
	}
	const dialogStyle: CSSProperties = {
		width: '100%',
		maxWidth: '460px',
		maxHeight: 'calc(100vh - 2rem)',
		overflowY: 'auto',
	}

	return createPortal(
		<div
			className='consent-overlay'
			role='presentation'
			style={overlayStyle}
			onMouseDown={e => {
				if (e.target === e.currentTarget) onClose()
			}}
		>
			<div
				ref={dialogRef}
				tabIndex={-1}
				className='consent-dialog auth-dialog'
				role='dialog'
				aria-modal='true'
				aria-labelledby='auth-title'
				style={dialogStyle}
			>
				<div className='auth-head'>
					<div>
						<div className='consent-badge'>Личный кабинет</div>
						<h2 id='auth-title'>
							{mode === 'login'
								? 'Вход в кабинет'
								: mode === 'reset'
									? 'Восстановление пароля'
									: 'Регистрация'}
						</h2>
					</div>
					<button
						type='button'
						className='auth-close'
						onClick={onClose}
						aria-label='Закрыть'
					>
						✕
					</button>
				</div>

				<div className='auth-tabs' role='tablist' aria-label='Вход или регистрация'>
					<button
						type='button'
						role='tab'
						aria-selected={mode === 'login'}
						className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`}
						onClick={() => switchMode('login')}
					>
						Вход
					</button>
					<button
						type='button'
						role='tab'
						aria-selected={mode === 'register'}
						className={`auth-tab ${mode === 'register' ? 'is-active' : ''}`}
						onClick={() => switchMode('register')}
					>
						Регистрация
					</button>
				</div>

				{mode === 'reset' ? (
					step === 'identify' ? (
						<form className='auth-form' onSubmit={submitResetStart}>
							<label className='auth-field'>
								<span>Почта аккаунта</span>
								<input
									type='email'
									autoComplete='email'
									value={email}
									onChange={e => setEmail(e.target.value)}
									placeholder='you@example.com'
									maxLength={254}
									required
								/>
							</label>
							<p className='auth-note'>
								Пришлём код из шести цифр. Он действует 10 минут — по нему вы
								придумаете новый пароль.
							</p>

							<CaptchaBlock
								captcha={captcha}
								answer={captchaAnswer}
								onAnswer={setCaptchaAnswer}
								onRefresh={loadCaptcha}
							/>

							{error && (
								<p className='auth-error' role='alert'>
									{error}
								</p>
							)}

							<button
								type='submit'
								className='consent-btn primary auth-submit'
								disabled={busy}
							>
								{busy ? 'Отправляю…' : 'Отправить код'}
							</button>
							<button
								type='button'
								className='consent-btn ghost auth-submit'
								onClick={() => switchMode('login')}
							>
								Назад ко входу
							</button>
						</form>
					) : (
						<form className='auth-form' onSubmit={submitResetVerify}>
							<p className='auth-note'>
								Если аккаунт с адресом <strong>{email}</strong> существует, письмо
								уже отправлено. Проверьте и «Спам».
							</p>

							<label className='auth-field'>
								<span>Код из письма</span>
								<input
									type='text'
									inputMode='numeric'
									autoComplete='one-time-code'
									value={code}
									onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
									placeholder='000000'
									maxLength={6}
									required
								/>
							</label>

							<label className='auth-field'>
								<span>Новый пароль</span>
								<input
									type='password'
									autoComplete='new-password'
									value={password}
									onChange={e => setPassword(e.target.value)}
									placeholder='Минимум 8 символов, буквы и цифры'
									maxLength={200}
									required
								/>
							</label>
							{password && (
								<div className='auth-strength' aria-live='polite'>
									<div className={`auth-strength-bar ${strengthCls}`}>
										{[0, 1, 2, 3, 4].map(i => (
											<span key={i} className={i < strength.score ? 'is-on' : ''} />
										))}
									</div>
									<p className='auth-strength-label'>
										{strength.label}
										{strength.issues[0] ? ` — ${strength.issues[0]}` : ''}
									</p>
								</div>
							)}

							<label className='auth-field'>
								<span>Повторите пароль</span>
								<input
									type='password'
									autoComplete='new-password'
									value={password2}
									onChange={e => setPassword2(e.target.value)}
									placeholder='Ещё раз'
									maxLength={200}
									required
								/>
							</label>
							{password2 && password2 !== password && (
								<p className='auth-error'>Пароли пока не совпадают.</p>
							)}

							{error && (
								<p className='auth-error' role='alert'>
									{error}
								</p>
							)}

							<button
								type='submit'
								className='consent-btn primary auth-submit'
								disabled={busy}
							>
								{busy ? 'Сохраняю…' : 'Сохранить пароль и войти'}
							</button>
							<button
								type='button'
								className='consent-btn ghost auth-submit'
								onClick={() => {
									setStep('identify')
									setCode('')
									setError('')
									void loadCaptcha()
								}}
							>
								Другая почта
							</button>
						</form>
					)
				) : mode === 'login' ? (
					<form className='auth-form' onSubmit={submitLogin}>
						<label className='auth-field'>
							<span>Почта или Twitch-логин</span>
							<input
								type='text'
								autoComplete='username'
								value={identifier}
								onChange={e => setIdentifier(e.target.value)}
								placeholder='you@example.com или jettle_'
								maxLength={254}
								required
							/>
						</label>
						<label className='auth-field'>
							<span>Пароль</span>
							<input
								type='password'
								autoComplete='current-password'
								value={password}
								onChange={e => setPassword(e.target.value)}
								placeholder='Ваш пароль'
								maxLength={200}
								required
							/>
						</label>

						{mode === 'login' && (
							<button type='button' className='auth-forgot' onClick={startReset}>
								Забыли пароль?
							</button>
						)}

						{captchaRequired && (
							<CaptchaBlock
								captcha={captcha}
								answer={captchaAnswer}
								onAnswer={setCaptchaAnswer}
								onRefresh={loadCaptcha}
							/>
						)}

						{error && (
							<p className='auth-error' role='alert'>
								{error}
							</p>
						)}

						<button type='submit' className='consent-btn primary auth-submit' disabled={busy}>
							{busy ? 'Проверяю…' : 'Войти'}
						</button>

						<div className='auth-or'>
							<span>или</span>
						</div>

						<a
							href={`/api/auth/twitch?next=${encodeURIComponent(next)}`}
							className='consent-btn auth-twitch'
						>
							<svg viewBox='0 0 24 24' width='16' height='16' fill='#fff' aria-hidden='true'>
								<path d='M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714H20.57z' />
							</svg>
							Войти через Twitch
						</a>

						<p className='consent-fine'>
							Нет аккаунта?{' '}
							<button type='button' className='auth-link' onClick={() => switchMode('register')}>
								Зарегистрируйтесь по почте
							</button>
							. Вход по Twitch-логину работает, если аккаунт привязан и у вас есть
							пароль.
						</p>
					</form>
				) : step === 'identify' ? (
					<form className='auth-form' onSubmit={submitRegisterStart}>
						<label className='auth-field'>
							<span>Почта</span>
							<input
								type='email'
								autoComplete='email'
								value={email}
								onChange={e => setEmail(e.target.value)}
								placeholder='you@example.com'
								maxLength={254}
								required
							/>
						</label>
						<p className='auth-note'>
							Пришлём код из шести цифр — он понадобится на следующем шаге.
						</p>

						<CaptchaBlock
							captcha={captcha}
							answer={captchaAnswer}
							onAnswer={setCaptchaAnswer}
							onRefresh={loadCaptcha}
						/>

						<div className='consent-row'>
							<input
								id='auth-terms'
								type='checkbox'
								checked={terms}
								onChange={e => setTerms(e.target.checked)}
								aria-label='Я принимаю Пользовательское соглашение и подтверждаю, что мне исполнилось 18 лет'
							/>
							<span>
								<label htmlFor='auth-terms'>Я принимаю </label>
								<Link href='/legal/terms' target='_blank' rel='noopener'>
									Пользовательское соглашение
								</Link>
								<label htmlFor='auth-terms'>
									{' '}
									(публичную оферту) и подтверждаю, что мне исполнилось 18 лет.
								</label>
							</span>
						</div>
						<div className='consent-row'>
							<input
								id='auth-pd'
								type='checkbox'
								checked={pd}
								onChange={e => setPd(e.target.checked)}
								aria-label='Я даю согласие на обработку персональных данных'
							/>
							<span>
								<label htmlFor='auth-pd'>Я даю </label>
								<Link href='/legal/consent' target='_blank' rel='noopener'>
									согласие на обработку персональных данных
								</Link>
								<label htmlFor='auth-pd'>
									{' '}
									в объёме и на условиях, описанных в{' '}
								</label>
								<Link href='/legal/privacy' target='_blank' rel='noopener'>
									Политике
								</Link>
								<label htmlFor='auth-pd'>.</label>
							</span>
						</div>

						{hint && (
							<p className='consent-hint' role='alert'>
								{hint}
							</p>
						)}
						{error && (
							<p className='auth-error' role='alert'>
								{error}
							</p>
						)}

						<button type='submit' className='consent-btn primary auth-submit' disabled={busy}>
							{busy ? 'Отправляю…' : 'Получить код'}
						</button>
					</form>
				) : (
					<form className='auth-form' onSubmit={submitRegisterVerify}>
						<p className='auth-note'>
							Код отправлен на <strong>{email}</strong>. Письмо может прийти в
							«Спам».
						</p>
						{devCode && (
							<p className='auth-devcode'>
								Локальный стенд: письма не уходят, ваш код —{' '}
								<strong>{devCode}</strong>
							</p>
						)}

						<label className='auth-field'>
							<span>Код из письма</span>
							<input
								type='text'
								inputMode='numeric'
								autoComplete='one-time-code'
								value={code}
								onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
								placeholder='000000'
								maxLength={6}
								required
							/>
						</label>

						<label className='auth-field'>
							<span>Придумайте пароль</span>
							<input
								type='password'
								autoComplete='new-password'
								value={password}
								onChange={e => setPassword(e.target.value)}
								placeholder='Минимум 8 символов, буквы и цифры'
								maxLength={200}
								required
							/>
						</label>
						{password && (
							<div className='auth-strength' aria-live='polite'>
								<div className={`auth-strength-bar ${strengthCls}`}>
									{[0, 1, 2, 3, 4].map(i => (
										<span key={i} className={i < strength.score ? 'is-on' : ''} />
									))}
								</div>
								<p className='auth-strength-label'>
									{strength.label}
									{strength.issues[0] ? ` — ${strength.issues[0]}` : ''}
								</p>
							</div>
						)}

						<label className='auth-field'>
							<span>Подтверждение пароля</span>
							<input
								type='password'
								autoComplete='new-password'
								value={password2}
								onChange={e => setPassword2(e.target.value)}
								placeholder='Ещё раз'
								maxLength={200}
								required
							/>
						</label>
						{password2 && password2 !== password && (
							<p className='auth-error'>Пароли пока не совпадают.</p>
						)}

						{error && (
							<p className='auth-error' role='alert'>
								{error}
							</p>
						)}

						<button type='submit' className='consent-btn primary auth-submit' disabled={busy}>
							{busy ? 'Создаю…' : 'Создать аккаунт'}
						</button>
						<button
							type='button'
							className='consent-btn ghost auth-submit'
							onClick={() => {
								setStep('identify')
								setError('')
								setHint('')
								setDevCode('')
								void loadCaptcha()
							}}
						>
							Назад
						</button>
					</form>
				)}
			</div>
		</div>,
		document.body,
	)
}

function CaptchaBlock({
	captcha,
	answer,
	onAnswer,
	onRefresh,
}: {
	captcha: Captcha | null
	answer: string
	onAnswer: (v: string) => void
	onRefresh: () => void
}) {
	return (
		<div className='auth-captcha'>
			<div className='auth-captcha-head'>
				<span>Проверка, что вы не робот</span>
				<button type='button' className='auth-link' onClick={onRefresh}>
					Другая картинка
				</button>
			</div>
			{captcha ? (
				<img
					src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.svg)}`}
					alt='Капча: введите символы с картинки'
					width={180}
					height={64}
					className='auth-captcha-img'
				/>
			) : (
				<span className='auth-captcha-img is-loading' aria-hidden='true' />
			)}
			<input
				type='text'
				value={answer}
				onChange={e => onAnswer(e.target.value.toUpperCase().slice(0, 6))}
				placeholder='Символы с картинки'
				autoComplete='off'
				maxLength={6}
				className='auth-captcha-input'
				required
			/>
		</div>
	)
}
