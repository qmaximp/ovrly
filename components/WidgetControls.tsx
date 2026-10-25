'use client'

import type { WidgetVariable } from '@/lib/types'
import { isNonLiveWidgetType } from '@/lib/widgets'

type Props = {
	variable: WidgetVariable
	value: string
	onChange: (value: string) => void
	onTrigger?: () => void
}

// Контрол одной переменной виджета. Используется и в свойствах элемента
// на холсте, и в предпросмотре студии виджетов.
export default function WidgetVariableControl({
	variable,
	value,
	onChange,
	onTrigger,
}: Props) {
	const label = (
		<div className='flex items-center gap-1.5 mb-1'>
			<span className='text-xs text-gray-500'>{variable.name}</span>
			{variable.live && !isNonLiveWidgetType(variable.type) && (
				<span
					className='w-1.5 h-1.5 rounded-full bg-green-400'
					title='Live: обновляется без перезагрузки'
				/>
			)}
		</div>
	)

	if (variable.type === 'toggle') {
		const on = value === 'true'
		return (
			<div>
				{label}
				<button
					onClick={() => onChange(on ? 'false' : 'true')}
					className='w-full flex items-center justify-between px-3 py-2 bg-bg border border-border rounded-lg text-sm'
				>
					<span>{on ? 'Включено' : 'Выключено'}</span>
					<span
						className={`w-9 h-5 rounded-full relative shrink-0 ${on ? 'bg-green-500' : 'bg-gray-600'}`}
					>
						<span
							className='absolute top-[2px] w-4 h-4 bg-white rounded-full transition-all'
							style={{ left: on ? 18 : 2 }}
						/>
					</span>
				</button>
			</div>
		)
	}

	if (variable.type === 'boolean') {
		const on = value === 'true'
		return (
			<div>
				{label}
				<label className='flex items-center gap-2 px-3 py-2 bg-bg border border-border rounded-lg text-sm cursor-pointer'>
					<input
						type='checkbox'
						checked={on}
						onChange={e => onChange(e.target.checked ? 'true' : 'false')}
						className='accent-accent'
					/>
					<span className='font-mono text-xs text-gray-400'>
						{on ? 'true' : 'false'}
					</span>
				</label>
			</div>
		)
	}

	if (variable.type === 'color') {
		const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
		return (
			<div>
				{label}
				<div className='flex gap-2'>
					<input
						type='color'
						value={hex}
						onChange={e => onChange(e.target.value)}
						className='w-10 h-9 shrink-0 rounded-lg border border-border bg-bg cursor-pointer'
					/>
					<input
						type='text'
						value={value}
						onChange={e => onChange(e.target.value)}
						className='flex-1 min-w-0 px-2 py-1.5 bg-bg border border-border rounded-lg text-sm font-mono'
					/>
				</div>
			</div>
		)
	}

	if (variable.type === 'media') {
		const image = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(value)
		return (
			<div>
				{label}
				<input
					type='url'
					value={value}
					onChange={e => onChange(e.target.value)}
					placeholder='https://…'
					className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
				/>
				{image && value ? (
					<img
						src={value}
						alt=''
						className='mt-1.5 h-16 max-w-full rounded-lg border border-border object-contain bg-bg'
					/>
				) : null}
			</div>
		)
	}

	if (variable.type === 'slider') {
		const min = variable.min ?? 0
		const max = variable.max ?? 100
		const step = variable.step ?? 1
		const n = Math.min(max, Math.max(min, Number(value) || 0))
		return (
			<div>
				{label}
				<div className='flex items-center gap-2'>
					<input
						type='range'
						min={min}
						max={max}
						step={step}
						value={n}
						onChange={e => onChange(e.target.value)}
						className='flex-1 accent-accent'
					/>
					<span className='w-10 text-right text-xs text-gray-400 tabular-nums'>
						{n}
					</span>
				</div>
			</div>
		)
	}

	if (variable.type === 'counter') {
		const min = variable.min ?? -Infinity
		const max = variable.max ?? Infinity
		const step = variable.step ?? 1
		const n = Number(value) || 0
		const move = (dir: number) =>
			onChange(String(Math.min(max, Math.max(min, n + dir * step))))
		return (
			<div>
				{label}
				<div className='flex items-center gap-2'>
					<button
						onClick={() => move(-1)}
						className='w-9 h-9 rounded-lg bg-border hover:bg-gray-600 text-white text-lg shrink-0'
					>
						−
					</button>
					<span className='flex-1 text-center text-base font-semibold tabular-nums'>
						{n}
					</span>
					<button
						onClick={() => move(1)}
						className='w-9 h-9 rounded-lg bg-border hover:bg-gray-600 text-white text-lg shrink-0'
					>
						+
					</button>
				</div>
			</div>
		)
	}

	if (variable.type === 'dropdown') {
		const options = (variable.options || []).filter(Boolean)
		if (options.length) {
			return (
				<div>
					{label}
					<select
						value={value}
						onChange={e => onChange(e.target.value)}
						className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
					>
						{options.includes(value) ? null : (
							<option value={value}>{value || '—'}</option>
						)}
						{options.map(option => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>
			)
		}
	}

	if (variable.type === 'datetime') {
		const local = value.includes('T') ? value.slice(0, 16) : value
		return (
			<div>
				{label}
				<input
					type='datetime-local'
					value={local}
					onChange={e => onChange(e.target.value)}
					className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
				/>
			</div>
		)
	}

	if (variable.type === 'list') {
		return (
			<div>
				{label}
				<textarea
					rows={3}
					value={value}
					onChange={e => onChange(e.target.value)}
					placeholder='Одна строка — один пункт'
					className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm resize-y'
				/>
			</div>
		)
	}

	if (variable.type === 'checkboxes') {
		const options = (variable.options || []).filter(Boolean)
		const current = value
			.split(',')
			.map(part => part.trim())
			.filter(Boolean)
		if (options.length) {
			return (
				<div>
					{label}
					<div className='space-y-1'>
						{options.map(option => {
							const checked = current.includes(option)
							return (
								<label
									key={option}
									className='flex items-center gap-2 px-3 py-1.5 bg-bg border border-border rounded-lg text-sm cursor-pointer'
								>
									<input
										type='checkbox'
										checked={checked}
										onChange={() => {
											const next = checked
												? current.filter(x => x !== option)
												: [...current, option]
											onChange(
												options
													.filter(o => next.includes(o))
													.join(', '),
											)
										}}
										className='accent-accent'
									/>
									<span>{option}</span>
								</label>
							)
						})}
					</div>
				</div>
			)
		}
	}

	if (variable.type === 'button') {
		return (
			<div>
				{label}
				<button
					onClick={onTrigger}
					className='w-full px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm rounded-lg transition-colors'
				>
					{variable.name}
				</button>
			</div>
		)
	}

	return (
		<div>
			{label}
			<input
				type='text'
				value={value}
				onChange={e => onChange(e.target.value)}
				className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
			/>
		</div>
	)
}
