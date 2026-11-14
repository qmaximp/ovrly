export type AccentPalette = {
	accent: string
	accent2: string
}

export type AccentPreset = AccentPalette & {
	id: string
	name: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
	{ id: 'teal', name: 'Бирюза', accent: '#0f766e', accent2: '#5eead4' },
	{ id: 'violet', name: 'Фиолет', accent: '#7c3aed', accent2: '#c4b5fd' },
	{ id: 'blue', name: 'Синий', accent: '#2563eb', accent2: '#93c5fd' },
	{ id: 'pink', name: 'Розовый', accent: '#db2777', accent2: '#f9a8d4' },
	{ id: 'orange', name: 'Оранж', accent: '#ea580c', accent2: '#fdba74' },
	{ id: 'emerald', name: 'Изумруд', accent: '#059669', accent2: '#6ee7b7' },
	{ id: 'red', name: 'Красный', accent: '#dc2626', accent2: '#fca5a5' },
	{ id: 'slate', name: 'Графит', accent: '#475569', accent2: '#94a3b8' },
]

const KEY_ACCENT = 'ovrly.accent-a'
const KEY_ACCENT2 = 'ovrly.accent-b'
const CSS_ACCENT = '--c-accent'
const CSS_ACCENT_HOVER = '--c-accent-hover'
const CSS_ACCENT2 = '--c-accent2'

const HEX_RE = /^#?([0-9a-f]{6})$/i

export function normalizeHex(input: string): string | null {
	const m = HEX_RE.exec(String(input || '').trim())
	if (!m) return null
	return '#' + m[1].toLowerCase()
}

export function hexToRgb(hex: string): [number, number, number] | null {
	const normalized = normalizeHex(hex)
	if (!normalized) return null
	const n = parseInt(normalized.slice(1), 16)
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(triplet: string): string | null {
	const parts = triplet
		.trim()
		.split(/[\s,]+/)
		.map(Number)
		.filter(n => Number.isFinite(n))
	if (parts.length < 3) return null
	const [r, g, b] = parts.map(n => Math.max(0, Math.min(255, Math.round(n))))
	return (
		'#' +
		[r, g, b]
			.map(n => n.toString(16).padStart(2, '0'))
			.join('')
	)
}

export function darkenHex(hex: string, amount = 0.18): string {
	const rgb = hexToRgb(hex)
	if (!rgb) return hex
	return (
		'#' +
		rgb
			.map(n => Math.max(0, Math.round(n * (1 - amount))))
			.map(n => n.toString(16).padStart(2, '0'))
			.join('')
	)
}

function triplet(hex: string): string {
	const rgb = hexToRgb(hex)
	return rgb ? rgb.join(' ') : ''
}

export function accentPaletteFromCss(): AccentPalette {
	if (typeof window === 'undefined') return { accent: '#0f766e', accent2: '#5eead4' }
	const styles = getComputedStyle(document.documentElement)
	return {
		accent: rgbToHex(styles.getPropertyValue(CSS_ACCENT)) || '#0f766e',
		accent2: rgbToHex(styles.getPropertyValue(CSS_ACCENT2)) || '#5eead4',
	}
}

export function loadAccentPalette(): AccentPalette | null {
	if (typeof window === 'undefined') return null
	try {
		const accent = normalizeHex(localStorage.getItem(KEY_ACCENT) || '')
		const accent2 = normalizeHex(localStorage.getItem(KEY_ACCENT2) || '')
		if (!accent || !accent2) return null
		return { accent, accent2 }
	} catch {
		return null
	}
}

export function applyAccentPalette(palette: AccentPalette): AccentPalette {
	const accent = normalizeHex(palette.accent) || '#0f766e'
	const accent2 = normalizeHex(palette.accent2) || '#5eead4'
	const hover = darkenHex(accent, 0.22)
	if (typeof document !== 'undefined') {
		const root = document.documentElement
		root.style.setProperty(CSS_ACCENT, triplet(accent))
		root.style.setProperty(CSS_ACCENT_HOVER, triplet(hover))
		root.style.setProperty(CSS_ACCENT2, triplet(accent2))
	}
	try {
		localStorage.setItem(KEY_ACCENT, accent)
		localStorage.setItem(KEY_ACCENT2, accent2)
		localStorage.setItem('ovrly.c-accent', triplet(accent))
		localStorage.setItem('ovrly.c-accent-hover', triplet(hover))
		localStorage.setItem('ovrly.c-accent2', triplet(accent2))
	} catch {}
	return { accent, accent2 }
}

export function clearAccentPalette() {
	if (typeof document !== 'undefined') {
		const root = document.documentElement
		root.style.removeProperty(CSS_ACCENT)
		root.style.removeProperty(CSS_ACCENT_HOVER)
		root.style.removeProperty(CSS_ACCENT2)
	}
	try {
		for (const key of [
			KEY_ACCENT,
			KEY_ACCENT2,
			'ovrly.c-accent',
			'ovrly.c-accent-hover',
			'ovrly.c-accent2',
		])
			localStorage.removeItem(key)
	} catch {}
}
