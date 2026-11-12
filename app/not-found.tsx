import Link from 'next/link'

export default function NotFound() {
	return (
		<main className='err-shell'>
			<div className='err-grid' aria-hidden='true' />
			<div className='err-card'>
				<span className='err-code'>404</span>
				<h1 className='err-title'>Страница ушла за кадр</h1>
				<p className='err-text'>
					Такого адреса нет — возможно, ссылка устарела или в ней опечатка.
					Оверлей и панель на месте, просто по другому пути.
				</p>
				<div className='err-actions'>
					<Link href='/' className='btn btn-primary'>
						На главную
					</Link>
					<Link href='/guide' className='btn btn-ghost'>
						Инструкция
					</Link>
				</div>
			</div>
		</main>
	)
}
