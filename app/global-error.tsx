'use client'

// Последний рубеж: сюда попадаем, если упал сам root layout, поэтому теги
// html/body обязательны, а стили держим инлайновыми — globals.css может быть
// недоступен.
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string }
	reset: () => void
}) {
	return (
		<html lang='ru'>
			<body
				style={{
					margin: 0,
					minHeight: '100vh',
					display: 'grid',
					placeItems: 'center',
					background: '#070b12',
					color: '#d9e8e6',
					fontFamily: "'Segoe UI', system-ui, sans-serif",
					textAlign: 'center',
					padding: '2rem',
				}}
			>
				<div style={{ maxWidth: '34rem' }}>
					<div
						style={{
							fontSize: 'clamp(4rem, 16vw, 7rem)',
							fontWeight: 800,
							lineHeight: 1,
							color: '#5eead4',
						}}
					>
						500
					</div>
					<h1 style={{ margin: '0.6rem 0 0.6rem', fontSize: '1.6rem' }}>
						Приложение не запустилось
					</h1>
					<p style={{ margin: '0 0 1.4rem', opacity: 0.72, lineHeight: 1.6 }}>
						Страница не смогла загрузиться целиком. Обновите её — если ошибка
						повторится, попробуйте позже.
					</p>
					<button
						type='button'
						onClick={reset}
						style={{
							cursor: 'pointer',
							border: 0,
							borderRadius: '0.7rem',
							padding: '0.8rem 1.5rem',
							font: 'inherit',
							fontWeight: 700,
							color: '#04110f',
							background: '#5eead4',
						}}
					>
						Обновить
					</button>
					{error.digest ? (
						<p style={{ marginTop: '1.2rem', fontSize: '0.75rem', opacity: 0.45 }}>
							Код ошибки: {error.digest}
						</p>
					) : null}
				</div>
			</body>
		</html>
	)
}
