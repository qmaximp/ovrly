'use client'

import { useEffect, useState } from 'react'
import { NumberField, DecimalField } from '@/components/fields'
import { TEXT_FONT_GROUPS, TEXT_WEIGHTS, ensureFontLoaded } from '@/lib/textStyle'
import type { StreamElement } from '@/lib/types'

// Полный блок оформления текста: он же используется и в правой панели свойств
// на ПК, и в мобильной шторке свойств (обе рендерят PropertyEditor).
// Компонент монтируется с key={el.id} — локальное состояние (цвет фона, сырые
// значения полей) не переносится между разными элементами
export default function TextStyleControls({
	el,
	update,
}: {
	el: StreamElement
	update: (partial: Partial<StreamElement>) => void
}) {
	const align = el.textAlign ?? 'center'
	const vAlign = el.verticalAlign ?? 'middle'
	const stroke = el.strokeWidth ?? 0
	const shadow = !!el.shadow
	// фон: отдельный режим «без фона», чтобы кнопка была понятной и обратимой
	const bgOff = !el.bgColor || el.bgColor === 'transparent'
	const [lastBg, setLastBg] = useState(
		el.bgColor && el.bgColor !== 'transparent' ? el.bgColor : '#000000',
	)

	// веб-шрифт (Google) подгружаем в момент выбора — и для превью текста,
	// и чтобы сам селект показал выбранную гарнитуру
	useEffect(() => {
		ensureFontLoaded(el.fontFamily)
	}, [el.fontFamily])

	// активный/обычный вид кнопок-переключателей (как у «Отразить» и замка)
	const btn = (active: boolean) =>
		`px-2 py-1.5 text-xs rounded-lg transition-colors ${
			active ? 'bg-accent text-white' : 'bg-border hover:bg-gray-600'
		}`
	const seg = (active: boolean) =>
		`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
			active ? 'bg-accent text-white' : 'bg-border hover:bg-gray-600 text-gray-300'
		}`

	return (
		<div className='space-y-4'>
			<div>
				<label className='text-xs text-gray-500 block mb-1'>Текст</label>
				<textarea
					value={el.text || ''}
					onChange={e => update({ text: e.target.value })}
					className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm resize-none'
					rows={3}
					placeholder='Текст (Enter — новая строка)'
				/>
			</div>

			<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1'>
				Шрифт
			</h3>
			<div>
				<label className='text-xs text-gray-500 block mb-1'>Шрифты</label>
				<select
					value={el.fontFamily ?? ''}
					onChange={e => update({ fontFamily: e.target.value })}
					className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
					style={{ fontFamily: el.fontFamily || undefined }}
				>
					{TEXT_FONT_GROUPS.map(group => (
						<optgroup key={group.label} label={group.label}>
							{group.fonts.map(f => (
								<option
									key={f.value || 'system'}
									value={f.value}
									style={{ fontFamily: f.value || undefined }}
								>
									{f.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
			</div>
			<div className='grid grid-cols-2 gap-2'>
				<NumberField
					label='Размер'
					value={el.fontSize || 24}
					onChange={v => update({ fontSize: v })}
					min={4}
					max={400}
				/>
				<div>
					<label className='text-xs text-gray-500 block mb-1'>Жирность</label>
					<select
						value={el.fontWeight || 'normal'}
						onChange={e => update({ fontWeight: e.target.value })}
						className='w-full px-2 py-1.5 bg-bg border border-border rounded-lg text-sm'
					>
						{TEXT_WEIGHTS.map(w => (
							<option key={w.value} value={w.value}>
								{w.label}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className='grid grid-cols-2 gap-2'>
				<button
					onClick={() => update({ italic: !el.italic })}
					title='Курсив'
					className={btn(!!el.italic)}
					style={{ fontStyle: 'italic' }}
				>
					Курсив
				</button>
				<button
					onClick={() => update({ underline: !el.underline })}
					title='Подчёркнутый'
					className={btn(!!el.underline)}
					style={{ textDecoration: 'underline' }}
				>
					Подчёркнутый
				</button>
			</div>

			<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1'>
				Выравнивание
			</h3>
			<div className='flex gap-1'>
				{((
					[
						['left', '⇤', 'По левому краю'],
						['center', '⇔', 'По центру'],
						['right', '⇥', 'По правому краю'],
					] as const
				)).map(([value, icon, title]) => (
					<button
						key={value}
						onClick={() => update({ textAlign: value })}
						title={title}
						className={seg(align === value)}
					>
						{icon}
					</button>
				))}
			</div>
			<div className='flex gap-1'>
				{((
					[
						['top', '⇡', 'К верху'],
						['middle', '⇕', 'По середине'],
						['bottom', '⇣', 'К низу'],
					] as const
				)).map(([value, icon, title]) => (
					<button
						key={value}
						onClick={() => update({ verticalAlign: value })}
						title={title}
						className={seg(vAlign === value)}
					>
						{icon}
					</button>
				))}
			</div>

			<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1'>
				Интервалы
			</h3>
			<div className='grid grid-cols-2 gap-2'>
				<DecimalField
					label='Строк'
					value={el.lineHeight ?? 1.2}
					onChange={v => update({ lineHeight: v })}
					step={0.1}
					min={0.5}
					max={4}
					title='Межстрочный интервал, множитель'
				/>
				<DecimalField
					label='Между буквами'
					value={el.letterSpacing ?? 0}
					onChange={v => update({ letterSpacing: v })}
					step={0.5}
					min={-50}
					max={200}
					title='Межбуквенное расстояние, px'
				/>
			</div>

			<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1'>
				Цвет и фон
			</h3>
			<div className='grid grid-cols-2 gap-2'>
				<div>
					<label className='text-xs text-gray-500 block mb-1'>Цвет текста</label>
					<input
						type='color'
						value={el.color || '#ffffff'}
						onChange={e => update({ color: e.target.value })}
						className='w-full h-9 rounded-lg border border-border bg-bg cursor-pointer'
					/>
				</div>
				<div>
					<label className='text-xs text-gray-500 block mb-1'>Цвет фона</label>
					<input
						type='color'
						value={bgOff ? lastBg : el.bgColor || '#000000'}
						onChange={e => {
							// выбор цвета сразу включает фон
							setLastBg(e.target.value)
							update({ bgColor: e.target.value })
						}}
						title='Выбрать цвет — фон включится'
						className={`w-full h-9 rounded-lg border border-border bg-bg cursor-pointer transition-opacity ${
							bgOff ? 'opacity-40' : ''
						}`}
					/>
				</div>
			</div>
			<div className='flex gap-1'>
				<button
					onClick={() => update({ bgColor: lastBg })}
					title='Вернуть фон (последний выбранный цвет)'
					className={seg(!bgOff)}
				>
					Фон: цвет
				</button>
				<button
					onClick={() => update({ bgColor: 'transparent' })}
					title='Прозрачный фон — только текст'
					className={seg(bgOff)}
				>
					Без фона
				</button>
			</div>
			{!bgOff && (
				<div className='mt-2'>
					<label className='text-xs text-gray-500 block mb-1'>
						Прозрачность фона:{' '}
						{Math.round((el.bgOpacity ?? 1) * 100)}%
					</label>
					<input
						type='range'
						min={0}
						max={100}
						step={5}
						value={Math.round((el.bgOpacity ?? 1) * 100)}
						onChange={e =>
							update({ bgOpacity: Number(e.target.value) / 100 })
						}
						className='w-full accent-accent'
					/>
				</div>
			)}
			<div className='grid grid-cols-2 gap-2'>
				<NumberField
					label='Отступ'
					value={el.padding ?? 0}
					onChange={v => update({ padding: v })}
					min={0}
					max={400}
					title='Внутренний отступ от текста до фона'
				/>
				<NumberField
					label='Скругл.'
					value={el.radius ?? 0}
					onChange={v => update({ radius: v })}
					min={0}
					max={400}
					title='Скругление фона'
				/>
			</div>

			<h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide pt-1'>
				Обводка и тень
			</h3>
			<div className='grid grid-cols-2 gap-2'>
				<button
					onClick={() =>
						update(
							stroke
								? { strokeWidth: 0 }
								: { strokeWidth: 3, strokeColor: el.strokeColor || '#000000' },
						)
					}
					title='Обводка букв (читаемость на любом фоне)'
					className={btn(stroke > 0)}
				>
					Обводка
				</button>
				<button
					onClick={() =>
						update(
							shadow
								? { shadow: false }
								: { shadow: true, shadowColor: el.shadowColor || 'rgba(0,0,0,0.85)' },
						)
					}
					title='Тень под буквами'
					className={btn(shadow)}
				>
					Тень
				</button>
			</div>
			{stroke > 0 && (
				<div className='grid grid-cols-2 gap-2'>
					<DecimalField
						label='Толщина'
						value={stroke}
						onChange={v => update({ strokeWidth: v })}
						step={0.5}
						min={0}
						max={20}
						title='Толщина обводки, px'
					/>
					<div>
						<label className='text-xs text-gray-500 block mb-1'>Цвет обводки</label>
						<input
							type='color'
							value={el.strokeColor || '#000000'}
							onChange={e => update({ strokeColor: e.target.value })}
							className='w-full h-9 rounded-lg border border-border bg-bg cursor-pointer'
						/>
					</div>
				</div>
			)}
			{shadow && (
				<div>
					<label className='text-xs text-gray-500 block mb-1'>Цвет тени</label>
					<input
						type='color'
						value={el.shadowColor && el.shadowColor.startsWith('#') ? el.shadowColor : '#000000'}
						onChange={e => update({ shadowColor: e.target.value })}
						className='w-full h-9 rounded-lg border border-border bg-bg cursor-pointer'
					/>
				</div>
			)}
		</div>
	)
}
