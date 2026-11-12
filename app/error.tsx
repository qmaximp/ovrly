'use client'

import Link from 'next/link'
import { useEffect } from 'react'

// Ошибка рендера на любой странице: показываем свои 500 вместо стандартного
// экрана Next. Сброс перерисовывает сегмент, ссылка — аварийный выход.
export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	useEffect(() => {
		console.error(error)
	}, [error])

	return (
		<main className='err-shell'>
			<div className='err-grid' aria-hidden='true' />
			<div className='err-card'>
				<span className='err-code'>500</span>
				<h1 className='err-title'>Оверлей поплыл</h1>
				<p className='err-text'>
					Что-то сломалось при отрисовке страницы. Попробуйте обновить —
					обычно этого достаточно. Если нет, вернитесь на главную.
				</p>
				<div className='err-actions'>
					<button type='button' className='btn btn-primary' onClick={reset}>
						Попробовать снова
					</button>
					<Link href='/' className='btn btn-ghost'>
						На главную
					</Link>
				</div>
				{error.digest ? <p className='err-digest'>Код ошибки: {error.digest}</p> : null}
			</div>
		</main>
	)
}
