'use client'

import { useEffect, useState } from 'react'
import TelegramCard from '@/components/TelegramCard'

// временная страница для проверки показа карточки (удаляется после отладки)
export default function TgTest() {
	const [n, setN] = useState(0)
	const [show, setShow] = useState(0)
	useEffect(() => {
		if (!n) return
		const at = Date.now()
		setShow(at)
	}, [n])
	return (
		<div style={{ position: 'fixed', inset: 0, background: '#101820' }}>
			<button
				style={{ position: 'absolute', zIndex: 10, left: 10, top: 10 }}
				onClick={() => setN(v => v + 1)}
			>
				show
			</button>
			{show > 0 && (
				<TelegramCard
					channel='durov'
					duration={5}
					until={show + 5000}
					show={show}
					instanceId='tg-test'
				/>
			)}
		</div>
	)
}
