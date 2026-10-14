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
	const commit = (raw: string) => {
		const n = parseInt(raw, 10)
		if (isNaN(n)) {
			onChange(min !== undefined && min > 0 ? min : 0)
			return
		}
		onChange(
			Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)),
		)
	}
	return (
		<div title={title}>
			<label className='text-xs text-gray-500 block mb-1'>{label}</label>
			<input
				type='number'
				value={value}
				min={min}
				max={max}
				onChange={e => commit(e.target.value)}
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
