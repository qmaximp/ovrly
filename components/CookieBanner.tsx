'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const KEY = 'ovrly_cookie_notice_v1'

// Информационное сообщение о cookie. Сервис использует только строго
// необходимые cookie, поэтому блокирующего согласия не требуется.
export default function CookieBanner() {
	const [show, setShow] = useState(false)

	useEffect(() => {
		try {
			if (!localStorage.getItem(KEY)) setShow(true)
		} catch {
			// приватный режим / запрет хранилища — молчим, чтобы не мешать
		}
	}, [])

	if (!show) return null

	const dismiss = () => {
		try {
			localStorage.setItem(KEY, '1')
		} catch {
			// ignore
		}
		setShow(false)
	}

	return (
		<div className='cookie-banner' role='region' aria-label='Использование cookie'>
			<p>
				Мы используем только необходимые cookie, чтобы вы могли войти и
				пользоваться сервисом. Аналитики и рекламных трекеров нет.{' '}
				<Link href='/legal/cookies'>Подробнее</Link>
			</p>
			<button type='button' className='cookie-banner-btn' onClick={dismiss}>
				Понятно
			</button>
		</div>
	)
}
