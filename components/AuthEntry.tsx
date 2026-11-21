'use client'

import { useState, type ReactNode } from 'react'
import AuthDialog from './AuthDialog'

// Кнопка, которая открывает модалку входа/регистрации.
// Живёт отдельно от лендинга, потому что лендинг — серверный компонент.
export default function AuthEntry({
	children,
	className,
	next = '/cabinet',
	initialMode = 'login',
	initialOpen = false,
}: {
	children: ReactNode
	className?: string
	next?: string
	initialMode?: 'login' | 'register'
	initialOpen?: boolean
}) {
	const [open, setOpen] = useState(initialOpen)

	return (
		<>
			<button type='button' className={className} onClick={() => setOpen(true)}>
				{children}
			</button>
			<AuthDialog
				open={open}
				onClose={() => setOpen(false)}
				next={next}
				initialMode={initialMode}
			/>
		</>
	)
}
