'use client'

import { useState } from 'react'

// Числовое поле для свойств элемента. Границы применяются, только если переданы
// (у X/Y отрицательные значения — норма: это зона предзагрузки вокруг холста)
export function NumberField({
	label,
	value,
	onChange,
	min,
	max,
	title,
}: {
	label: string
	value: number
	onChange: (v: number) => void
	min?: number
	max?: number
	title?: string
}) {
	// Черновик строки, пока поле в фокусе: без него «-» и «1.» затирались
	// мгновенным parseInt/onChange (нельзя было ввести отрицательный X/Y)
	const [raw, setRaw] = useState<string | null>(null)
	const clamp = (n: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))
	const commit = (text: string) => {
		setRaw(text)
		const n = parseInt(text, 10)
		if (!isNaN(n)) onChange(clamp(n))
	}

	return (
		<div title={title}>
			<label className='text-xs text-gray-500 block mb-1'>{label}</label>
			<input
				type='number'
				inputMode='numeric'
				value={raw ?? String(value)}
				min={min}
				max={max}
				onChange={e => commit(e.target.value)}
				onBlur={() => {
					if (raw !== null) {
						const n = parseInt(raw, 10)
						onChange(isNaN(n) ? (min !== undefined && min > 0 ? min : 0) : clamp(n))
					}
					setRaw(null)
				}}
				onKeyDown={e => {
					if (e.key === 'Enter') e.currentTarget.blur()
				}}
				className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
			/>
		</div>
	)
}

// Поле с дробными значениями (межстрочный интервал и т.п.). Пока пользователь
// печатает, держим сырую строку: иначе «1.» мгновенно превращалось бы в «1»
// и точку ввести было бы нельзя
export function DecimalField({
	label,
	value,
	onChange,
	step = 0.1,
	min,
	max,
	title,
}: {
	label: string
	value: number
	onChange: (v: number) => void
	step?: number
	min?: number
	max?: number
	title?: string
}) {
	const [raw, setRaw] = useState<string | null>(null)
	const commit = (text: string) => {
		setRaw(text)
		const n = parseFloat(text.replace(',', '.'))
		if (isNaN(n)) return
		onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)))
	}
	return (
		<div title={title}>
			<label className='text-xs text-gray-500 block mb-1'>{label}</label>
			<input
				type='number'
				step={step}
				min={min}
				max={max}
				value={raw ?? String(value)}
				onChange={e => commit(e.target.value)}
				onBlur={() => setRaw(null)}
				className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
			/>
		</div>
	)
}
