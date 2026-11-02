'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'

// Согласие до сбора данных: пока пользователь не принял соглашение и не дал
// согласие на обработку ПДн, /api/auth/twitch не начинает OAuth-обмен.
export default function ConsentDialog({
	open,
	next,
}: {
	open: boolean
	next: string
}) {
	const [visible, setVisible] = useState(open)
	const [terms, setTerms] = useState(false)
	const [pd, setPd] = useState(false)
	const [hint, setHint] = useState(false)
	const firstRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		setVisible(open)
	}, [open])

	const close = () => {
		setVisible(false)
		setHint(false)
		try {
			const url = new URL(window.location.href)
			url.searchParams.delete('consent')
			url.searchParams.delete('next')
			window.history.replaceState(null, '', url.pathname + url.search)
		} catch {
			// ignore
		}
	}

	useEffect(() => {
		if (!visible) return
		document.body.style.overflow = 'hidden'
		firstRef.current?.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close()
		}
		window.addEventListener('keydown', onKey)
		return () => {
			document.body.style.overflow = ''
			window.removeEventListener('keydown', onKey)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [visible])

	const submit = (e: FormEvent<HTMLFormElement>) => {
		if (!terms || !pd) {
			e.preventDefault()
			setHint(true)
		}
	}

	if (!visible) return null

	return (
		<div
			className='consent-overlay'
			role='presentation'
			onMouseDown={e => {
				if (e.target === e.currentTarget) close()
			}}
		>
			<form
				className='consent-dialog'
				role='dialog'
				aria-modal='true'
				aria-labelledby='consent-title'
				action='/api/consent'
				method='post'
				onSubmit={submit}
			>
				<input type='hidden' name='next' value={next} />
				<div className='consent-badge'>Перед входом</div>
				<h2 id='consent-title'>Согласие и документы</h2>
				<p className='consent-lead'>
					Ovrly — бесплатный сервис. Чтобы войти через Twitch, нужно принять
					условия и отдельно согласиться на обработку персональных данных.
				</p>

				{/* ссылки специально вне <label>, чтобы клик по документу не ставил
				    галочку случайно */}
				<div className='consent-row'>
					<input
						ref={firstRef}
						id='consent-terms'
						type='checkbox'
						name='terms'
						aria-label='Я принимаю Пользовательское соглашение и подтверждаю, что мне исполнилось 18 лет'
						checked={terms}
						onChange={e => setTerms(e.target.checked)}
					/>
					<span>
						<label htmlFor='consent-terms'>Я принимаю </label>
						<Link href='/legal/terms' target='_blank' rel='noopener'>
							Пользовательское соглашение
						</Link>
						<label htmlFor='consent-terms'>
							{' '}
							(публичную оферту) и подтверждаю, что мне исполнилось 18 лет.
						</label>
					</span>
				</div>

				<div className='consent-row'>
					<input
						id='consent-pd'
						type='checkbox'
						name='pd'
						aria-label='Я даю согласие на обработку персональных данных'
						checked={pd}
						onChange={e => setPd(e.target.checked)}
					/>
					<span>
						<label htmlFor='consent-pd'>Я даю </label>
						<Link href='/legal/consent' target='_blank' rel='noopener'>
							согласие на обработку персональных данных
						</Link>
						<label htmlFor='consent-pd'>
							{' '}
							в объёме и на условиях, описанных в{' '}
						</label>
						<Link href='/legal/privacy' target='_blank' rel='noopener'>
							Политике
						</Link>
						<label htmlFor='consent-pd'>.</label>
					</span>
				</div>

				{hint && (
					<p className='consent-hint' role='alert'>
						Отметьте оба пункта, чтобы продолжить.
					</p>
				)}

				<div className='consent-actions'>
					<button type='button' className='consent-btn ghost' onClick={close}>
						Отмена
					</button>
					<button type='submit' className='consent-btn primary'>
						Продолжить вход
					</button>
				</div>

				<p className='consent-fine'>
					Вход выполняется через Twitch. Мы не получаем ваш пароль и не
					запрашиваем адрес электронной почты. Отозвать согласие можно в любой
					момент — инструкция в{' '}
					<Link href='/legal/privacy' target='_blank' rel='noopener'>
						Политике
					</Link>
					.
				</p>
			</form>
		</div>
	)
}
