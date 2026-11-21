'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { setCookieChoice } from '@/lib/cookieChoice'

// Информационное сообщение о cookie + отдельный выбор «не передавать».
// Сервис использует только строго необходимые cookie: здесь нет аналитики и
// рекламных пикселей. Кнопка «Не передавать» фиксирует отказ на будущее —
// если когда-нибудь появится необязательный трекер, он обязан спросить этот
// флаг, прежде чем что-то отправлять.
export default function CookieBanner() {
	const [show, setShow] = useState(false)

	useEffect(() => {
		try {
			if (!localStorage.getItem('ovrly_cookie_notice_v1')) setShow(true)
		} catch {
			// приватный режим / запрет хранилища — молчим, чтобы не мешать
		}
	}, [])

	if (!show) return null

	const choose = (share: boolean) => {
		setCookieChoice(share)
		setShow(false)
	}

	return (
		<div className='cookie-banner' role='region' aria-label='Использование cookie'>
			<p>
				Мы используем только необходимые cookie, чтобы вы могли войти и
				пользоваться сервисом. Аналитики и рекламных трекеров нет, данные
				cookie третьим лицам не передаются.{' '}
				<Link href='/legal/cookies'>Подробнее</Link>
			</p>
			<div className='cookie-banner-actions'>
				<button
					type='button'
					className='cookie-banner-btn is-ghost'
					onClick={() => choose(false)}
					title='Отказаться от передачи данных cookie третьим лицам'
				>
					Не передавать
				</button>
				<button type='button' className='cookie-banner-btn' onClick={() => choose(true)}>
					Понятно
				</button>
			</div>
		</div>
	)
}
