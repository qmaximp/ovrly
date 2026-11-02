// Горячие клавиши панели: один список для обработчика и настроек.
// Комбинация хранится как «mod+Shift+KeyZ» — по e.code, поэтому не зависит
// от русской раскладки.

export type ShortcutId =
	| 'undo'
	| 'redo'
	| 'delete'
	| 'left'
	| 'right'
	| 'up'
	| 'down'
	| 'fastLeft'
	| 'fastRight'
	| 'fastUp'
	| 'fastDown'
	| 'deselect'

export type ShortcutDef = {
	id: ShortcutId
	label: string
	hint: string
	fallback: string
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
	{
		id: 'undo',
		label: 'Отменить',
		hint: 'Шаг назад по истории изменений',
		fallback: 'mod+KeyZ',
	},
	{
		id: 'redo',
		label: 'Повторить',
		hint: 'Вернуть отменённое действие',
		fallback: 'mod+Shift+KeyZ',
	},
	{
		id: 'delete',
		label: 'Удалить элемент',
		hint: 'Удаляет выбранные элементы (Backspace тоже работает)',
		fallback: 'Delete',
	},
	{
		id: 'left',
		label: 'Сдвиг влево',
		hint: 'Переместить выделение на 1 px',
		fallback: 'ArrowLeft',
	},
	{
		id: 'right',
		label: 'Сдвиг вправо',
		hint: 'Переместить выделение на 1 px',
		fallback: 'ArrowRight',
	},
	{
		id: 'up',
		label: 'Сдвиг вверх',
		hint: 'Переместить выделение на 1 px',
		fallback: 'ArrowUp',
	},
	{
		id: 'down',
		label: 'Сдвиг вниз',
		hint: 'Переместить выделение на 1 px',
		fallback: 'ArrowDown',
	},
	{
		id: 'fastLeft',
		label: 'Влево на 10 px',
		hint: 'Быстрый сдвиг выделения',
		fallback: 'Shift+ArrowLeft',
	},
	{
		id: 'fastRight',
		label: 'Вправо на 10 px',
		hint: 'Быстрый сдвиг выделения',
		fallback: 'Shift+ArrowRight',
	},
	{
		id: 'fastUp',
		label: 'Вверх на 10 px',
		hint: 'Быстрый сдвиг выделения',
		fallback: 'Shift+ArrowUp',
	},
	{
		id: 'fastDown',
		label: 'Вниз на 10 px',
		hint: 'Быстрый сдвиг выделения',
		fallback: 'Shift+ArrowDown',
	},
	{
		id: 'deselect',
		label: 'Снять выделение',
		hint: 'Закрывает свойства и снимает рамку',
		fallback: 'Escape',
	},
]

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> =
	SHORTCUT_DEFS.reduce(
		(acc, def) => {
			acc[def.id] = def.fallback
			return acc
		},
		{} as Record<ShortcutId, string>,
	)

const STORAGE_KEY = 'panel:shortcuts'

export function loadShortcuts(): Record<ShortcutId, string> {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return { ...DEFAULT_SHORTCUTS }
		const parsed = JSON.parse(raw) as Partial<Record<ShortcutId, string>>
		const next = { ...DEFAULT_SHORTCUTS }
		for (const def of SHORTCUT_DEFS) {
			const value = parsed?.[def.id]
			if (typeof value === 'string' && value) next[def.id] = value
		}
		return next
	} catch {
		return { ...DEFAULT_SHORTCUTS }
	}
}

export function saveShortcuts(map: Record<ShortcutId, string>) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
	} catch {
		// приватный режим / запрет localStorage — настройки живут до перезагрузки
	}
}

export function resetShortcuts() {
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {}
	return { ...DEFAULT_SHORTCUTS }
}

const MODIFIER_CODES = new Set([
	'ShiftLeft',
	'ShiftRight',
	'ControlLeft',
	'ControlRight',
	'AltLeft',
	'AltRight',
	'MetaLeft',
	'MetaRight',
])

export function comboFromEvent(e: KeyboardEvent): string | null {
	if (MODIFIER_CODES.has(e.code)) return null
	const parts: string[] = []
	if (e.ctrlKey || e.metaKey) parts.push('mod')
	if (e.altKey) parts.push('Alt')
	if (e.shiftKey) parts.push('Shift')
	parts.push(e.code)
	return parts.join('+')
}

export function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
	const parts = combo.split('+')
	const code = parts.pop()
	if (!code || e.code !== code) return false
	const mod = parts.includes('mod')
	const shift = parts.includes('Shift')
	const alt = parts.includes('Alt')
	if (mod !== (e.ctrlKey || e.metaKey)) return false
	if (shift !== e.shiftKey) return false
	if (alt !== e.altKey) return false
	return true
}

// Клавиши для красивых подсказок: Ctrl/⌘, Shift, Alt и сами символы.
export function shortcutKeys(combo: string, isMac: boolean): string[] {
	const parts = combo.split('+')
	const code = parts.pop() || ''
	const keys: string[] = []
	if (parts.includes('mod')) keys.push(isMac ? '⌘' : 'Ctrl')
	if (parts.includes('Alt')) keys.push(isMac ? '⌥' : 'Alt')
	if (parts.includes('Shift')) keys.push('Shift')
	const names: Record<string, string> = {
		ArrowLeft: '←',
		ArrowRight: '→',
		ArrowUp: '↑',
		ArrowDown: '↓',
		Delete: 'Del',
		Backspace: '⌫',
		Escape: 'Esc',
		Enter: 'Enter',
		Space: 'Space',
	}
	if (names[code]) keys.push(names[code])
	else if (code.startsWith('Key')) keys.push(code.slice(3))
	else if (code.startsWith('Digit')) keys.push(code.slice(5))
	else if (code.startsWith('Numpad')) keys.push(code.slice(6))
	else keys.push(code)
	return keys
}
