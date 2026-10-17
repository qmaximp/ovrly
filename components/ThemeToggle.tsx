'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

// Единый переключатель для лендинга, кабинета и админки. Панель использует
// свой такой же, чтобы синхронизироваться через html.light и localStorage.
export default function ThemeToggle({ className = '' }: { className?: string }) {
	const [theme, setTheme] = useState<Theme>('dark')

	useEffect(() => {
		setTheme(
			document.documentElement.classList.contains('light') ? 'light' : 'dark',
		)
	}, [])

	const toggle = () => {
		const next: Theme = theme === 'dark' ? 'light' : 'dark'
		const root = document.documentElement
		root.classList.add('theme-anim')
		root.classList.toggle('light', next === 'light')
		try {
			localStorage.setItem('theme', next)
		} catch {}
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', next === 'light' ? '#f3f0e8' : '#070b12')
		setTheme(next)
		window.setTimeout(() => root.classList.remove('theme-anim'), 450)
	}

	return (
		<button
			type='button'
			onClick={toggle}
			className={`theme-toggle ${className}`}
			aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
			title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
		>
			{theme === 'dark' ? (
				<svg
					width='17'
					height='17'
					viewBox='0 0 24 24'
					fill='none'
					stroke='currentColor'
					strokeWidth='1.8'
					strokeLinecap='round'
					aria-hidden='true'
				>
					<circle cx='12' cy='12' r='4' />
					<path d='M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41' />
				</svg>
			) : (
				<svg
					width='16'
					height='16'
					viewBox='0 0 24 24'
					fill='none'
					stroke='currentColor'
					strokeWidth='1.8'
					strokeLinecap='round'
					strokeLinejoin='round'
					aria-hidden='true'
				>
					<path d='M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z' />
				</svg>
			)}
		</button>
	)
}
