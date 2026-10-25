import { colorWithOpacity } from './color'
import type { CSSProperties } from 'react'
import type { StreamElement } from './types'

export type TextFont = {
	label: string
	// готовый CSS-стек строкой: оформление элемента самодостаточно (не зависит от
	// наших констант), '' — системный шрифт браузера
	value: string
	// веб-шрифт, который нужно подгрузить (family + доступные начертания)
	google?: { family: string; weights: string }
}

// Системные шрифты: ничего не грузят, есть на любой Windows-машине (и в OBS,
// он рисует системными). Обычные/декоративные — с запасом в стеке на случай,
// если шрифта нет или он без кириллицы (буквы подхватит следующий в стеке)
const SYSTEM_FONTS: TextFont[] = [
	{ label: 'Системный', value: '' },
	{ label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
	{ label: 'Arial Black', value: '"Arial Black", "Arial Bold", Gadget, sans-serif' },
	{ label: 'Arial Narrow', value: '"Arial Narrow", Arial, sans-serif' },
	{ label: 'Segoe UI', value: '"Segoe UI", Roboto, sans-serif' },
	{ label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
	{ label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
	{ label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
	{ label: 'Calibri', value: 'Calibri, Candara, "Segoe UI", sans-serif' },
	{ label: 'Candara', value: 'Candara, Calibri, "Segoe UI", sans-serif' },
	{ label: 'Century Gothic', value: '"Century Gothic", "Apple Gothic", sans-serif' },
	{ label: 'Franklin Gothic', value: '"Franklin Gothic Medium", "Arial Narrow", sans-serif' },
	{ label: 'Bahnschrift', value: 'Bahnschrift, "DIN Alternate", "Segoe UI", sans-serif' },
	{ label: 'Impact', value: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
	{ label: 'Segoe Print', value: '"Segoe Print", "Bradley Hand", cursive' },
	{ label: 'Segoe Script', value: '"Segoe Script", "Bradley Hand", cursive' },
	{ label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Sans", cursive' },
	{ label: 'Brush Script MT', value: '"Brush Script MT", "Segoe Script", cursive' },
	{ label: 'Rockwell', value: 'Rockwell, "Roboto Slab", "Courier New", serif' },
	{ label: 'Copperplate Gothic', value: '"Copperplate Gothic Light", Copperplate, fantasy' },
	{ label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
	{ label: 'Cambria', value: 'Cambria, Cochin, Georgia, serif' },
	{ label: 'Constantia', value: 'Constantia, "Palatino Linotype", serif' },
	{ label: 'Palatino Linotype', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
	{ label: 'Bookman Old Style', value: '"Bookman Old Style", Georgia, serif' },
	{ label: 'Garamond', value: 'Garamond, Baskerville, "Times New Roman", serif' },
	{ label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
	{ label: 'Courier New', value: '"Courier New", Courier, monospace' },
	{ label: 'Consolas', value: 'Consolas, Menlo, monospace' },
	{ label: 'Cascadia Code', value: '"Cascadia Code", Consolas, monospace' },
	{ label: 'Lucida Console', value: '"Lucida Console", Monaco, monospace' },
	{ label: 'Lucida Sans Unicode', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
]

// Веб-шрифты Google: подгружаются в момент выбора (только те, что реально
// используются) — нужен интернет и в панели, и в браузер-источнике OBS.
// Подобраны так, чтобы поддерживать кириллицу
const GOOGLE_FONTS: TextFont[] = [
	{ label: 'Montserrat', value: '"Montserrat", "Segoe UI", sans-serif', google: { family: 'Montserrat', weights: '400;700;900' } },
	{ label: 'Oswald', value: '"Oswald", "Arial Narrow", sans-serif', google: { family: 'Oswald', weights: '400;700' } },
	{ label: 'Roboto', value: '"Roboto", "Segoe UI", sans-serif', google: { family: 'Roboto', weights: '400;700;900' } },
	{ label: 'Rubik', value: '"Rubik", "Segoe UI", sans-serif', google: { family: 'Rubik', weights: '400;700' } },
	{ label: 'Comfortaa', value: '"Comfortaa", "Segoe UI", sans-serif', google: { family: 'Comfortaa', weights: '400;700' } },
	{ label: 'Russo One', value: '"Russo One", "Arial Black", sans-serif', google: { family: 'Russo One', weights: '400' } },
	{ label: 'Philosopher', value: '"Philosopher", Georgia, serif', google: { family: 'Philosopher', weights: '400;700' } },
	{ label: 'Play', value: '"Play", "Segoe UI", sans-serif', google: { family: 'Play', weights: '400;700' } },
	{ label: 'Yeseva One', value: '"Yeseva One", Georgia, serif', google: { family: 'Yeseva One', weights: '400' } },
	{ label: 'Ruslan Display', value: '"Ruslan Display", "Arial Black", sans-serif', google: { family: 'Ruslan Display', weights: '400' } },
	{ label: 'Underdog', value: '"Underdog", "Comic Sans MS", cursive', google: { family: 'Underdog', weights: '400' } },
	{ label: 'Neucha', value: '"Neucha", "Comic Sans MS", cursive', google: { family: 'Neucha', weights: '400' } },
	{ label: 'Marck Script', value: '"Marck Script", "Segoe Script", cursive', google: { family: 'Marck Script', weights: '400' } },
	{ label: 'Bad Script', value: '"Bad Script", "Segoe Script", cursive', google: { family: 'Bad Script', weights: '400' } },
	{ label: 'Caveat', value: '"Caveat", "Segoe Script", cursive', google: { family: 'Caveat', weights: '400;700' } },
	{ label: 'Pacifico', value: '"Pacifico", "Segoe Script", cursive', google: { family: 'Pacifico', weights: '400' } },
	{ label: 'Lobster', value: '"Lobster", "Segoe Script", cursive', google: { family: 'Lobster', weights: '400' } },
]

// Список для селекта: системные отдельно от веб-шрифтов
export const TEXT_FONT_GROUPS: { label: string; fonts: TextFont[] }[] = [
	{ label: 'Системные', fonts: SYSTEM_FONTS },
	{ label: 'Google (нужен интернет)', fonts: GOOGLE_FONTS },
]

export const TEXT_FONTS: TextFont[] = TEXT_FONT_GROUPS.flatMap(g => g.fonts)

// какие веб-шрифты уже подключены в этом документе
const fontsLoaded = new Set<string>()

// Подключить веб-шрифт по требованию: <link> добавляется один раз на документ,
// только для выбранного шрифта. Системные ничего не грузят; если интернета нет —
// браузер просто возьмёт следующий шрифт из стека
export function ensureFontLoaded(value?: string | null) {
	if (!value || typeof document === 'undefined') return
	const font = TEXT_FONTS.find(f => f.value === value)
	if (!font?.google || fontsLoaded.has(font.google.family)) return
	fontsLoaded.add(font.google.family)
	const link = document.createElement('link')
	link.rel = 'stylesheet'
	link.href = `https://fonts.googleapis.com/css2?family=${font.google.family.replace(
		/ /g,
		'+',
	)}:wght@${font.google.weights}&display=swap`
	document.head.appendChild(link)
}

// Жирность: 'normal'/'bold' — старые значения (совместимость с уже сохранёнными
// элементами), числа — тонкие настройки для шрифтов с несколькими начертаниями
export const TEXT_WEIGHTS: { label: string; value: string }[] = [
	{ label: 'Тонкий (300)', value: '300' },
	{ label: 'Обычный', value: 'normal' },
	{ label: 'Средний (500)', value: '500' },
	{ label: 'Полужирный (600)', value: '600' },
	{ label: 'Жирный', value: 'bold' },
	{ label: 'Очень жирный (900)', value: '900' },
]

export type TextStyled = Pick<
	StreamElement,
	| 'fontSize'
	| 'color'
	| 'fontWeight'
	| 'fontFamily'
	| 'italic'
	| 'underline'
	| 'lineHeight'
	| 'letterSpacing'
	| 'strokeWidth'
	| 'strokeColor'
	| 'shadow'
	| 'shadowColor'
>

// Шрифт/начертание/обводка/тень. Вынесено отдельно, потому что нужно и контейнеру
// текста, и подписи таймера
export function textFontStyle(el: TextStyled, scale = 1): CSSProperties {
	const stroke = el.strokeWidth ?? 0
	return {
		fontSize: (el.fontSize || 24) * scale,
		color: el.color || '#fff',
		fontWeight: (el.fontWeight as CSSProperties['fontWeight']) || 'normal',
		fontFamily: el.fontFamily || undefined,
		fontStyle: el.italic ? 'italic' : 'normal',
		textDecoration: el.underline ? 'underline' : 'none',
		lineHeight: el.lineHeight ?? 1.2,
		letterSpacing: el.letterSpacing
			? `${Math.round(el.letterSpacing * scale * 100) / 100}px`
			: undefined,
		// обводка букв: -webkit-text-stroke есть и в обычных браузерах, и в Chromium OBS.
		// paint-order не даёт обводке «съедать» заливку буквы
		WebkitTextStrokeWidth: stroke ? `${stroke * scale}px` : undefined,
		WebkitTextStrokeColor: stroke ? el.strokeColor || '#000000' : undefined,
		paintOrder: stroke ? 'stroke fill' : undefined,
		textShadow: el.shadow
			? `${2 * scale}px ${2 * scale}px ${4 * scale}px ${el.shadowColor || 'rgba(0,0,0,0.85)'}`
			: undefined,
		whiteSpace: 'pre-wrap', // переносы строк из поля «Текст» доходят до оверлея
		wordBreak: 'break-word',
	}
}

// Блок текста: рамка элемента + положение текста внутри неё. Одни и те же стили
// для превью в панели и для оверлея — иначе картинка на стриме разойдётся с панелью
export function textBoxStyle(
	el: StreamElement,
	scale = 1,
): CSSProperties {
	const align = el.textAlign ?? 'center'
	const vAlign = el.verticalAlign ?? 'middle'
	return {
		...textFontStyle(el, scale),
		display: 'flex',
		flexDirection: 'column',
		justifyContent:
			vAlign === 'top' ? 'flex-start' : vAlign === 'bottom' ? 'flex-end' : 'center',
		alignItems:
			align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
		textAlign: align,
		overflow: 'hidden',
		padding: el.padding ? el.padding * scale : undefined,
		borderRadius: el.radius ? el.radius * scale : undefined,
		background: colorWithOpacity(el.bgColor, el.bgOpacity ?? 1),
	}
}
