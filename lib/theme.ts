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

export type SurfacePalette = { bg: string; panel: string }

export type SurfacePreset = SurfacePalette & { id: string; name: string }

export const SURFACE_PRESETS: Record<'dark' | 'light', SurfacePreset[]> = {
	dark: [
		{ id: 'night', name: 'Ночной', bg: '#070b12', panel: '#0c1522' },
		{ id: 'graphite', name: 'Графит', bg: '#0a0c0f', panel: '#151a20' },
		{ id: 'violet', name: 'Фиолет', bg: '#0b0714', panel: '#171029' },
		{ id: 'warm', name: 'Тёплый', bg: '#100b09', panel: '#1e1510' },
		{ id: 'forest', name: 'Лес', bg: '#06100d', panel: '#0c1d17' },
	],
	light: [
		{ id: 'porcelain', name: 'Фарфор', bg: '#f3f0e8', panel: '#fffdf7' },
		{ id: 'white', name: 'Белый', bg: '#f4f6f8', panel: '#ffffff' },
		{ id: 'warm', name: 'Тёплый', bg: '#f7f1e9', panel: '#fffaf3' },
		{ id: 'lavender', name: 'Лаванда', bg: '#f2f0f8', panel: '#fbfaff' },
		{ id: 'mint', name: 'Мята', bg: '#eef5f1', panel: '#f9fdfb' },
	],
}

const SURFACE_HEX = (theme: 'dark' | 'light') => ({
	bg: `ovrly.surface.${theme}.bg`,
	panel: `ovrly.surface.${theme}.panel`,
})
const SURFACE_CSS = (theme: 'dark' | 'light') => ({
	bg: `ovrly.c.${theme}.bg`,
	panel: `ovrly.c.${theme}.panel`,
	border: `ovrly.c.${theme}.border`,
	text: `ovrly.c.${theme}.text`,
	onBg: `ovrly.c.${theme}.on-bg`,
	canvas: `ovrly.c.${theme}.canvas`,
	dot: `ovrly.c.${theme}.dot`,
	sbTrack: `ovrly.c.${theme}.sb-track`,
	sbThumb: `ovrly.c.${theme}.sb-thumb`,
	sbThumbHover: `ovrly.c.${theme}.sb-thumb-hover`,
})

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

function clampByte(n: number) {
	return Math.max(0, Math.min(255, Math.round(n)))
}

function mixHex(a: string, b: string, t: number): string {
	const ca = hexToRgb(a)
	const cb = hexToRgb(b)
	if (!ca || !cb) return a
	const [r, g, bl] = ca.map((v, i) => clampByte(v * (1 - t) + cb[i] * t))
	return '#' + [r, g, bl].map(n => n.toString(16).padStart(2, '0')).join('')
}

function luminance(hex: string): number {
	const rgb = hexToRgb(hex)
	if (!rgb) return 0
	const [r, g, b] = rgb.map(v => {
		const s = v / 255
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	})
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function surfacePaletteFromCss(): SurfacePalette {
	if (typeof window === 'undefined')
		return { bg: '#070b12', panel: '#0c1522' }
	const styles = getComputedStyle(document.documentElement)
	return {
		bg: rgbToHex(styles.getPropertyValue('--c-bg')) || '#070b12',
		panel: rgbToHex(styles.getPropertyValue('--c-panel')) || '#0c1522',
	}
}

export function loadSurfacePalette(
	theme: 'dark' | 'light',
): SurfacePalette | null {
	if (typeof window === 'undefined') return null
	try {
		const keys = SURFACE_HEX(theme)
		const bg = normalizeHex(localStorage.getItem(keys.bg) || '')
		const panel = normalizeHex(localStorage.getItem(keys.panel) || '')
		if (!bg || !panel) return null
		return { bg, panel }
	} catch {
		return null
	}
}

function surfaceColors(theme: 'dark' | 'light', palette: SurfacePalette) {
	const bg = normalizeHex(palette.bg) || '#070b12'
	const panel = normalizeHex(palette.panel) || '#0c1522'
	const isLight = luminance(bg) > 0.52
	const text = isLight ? '#1c2b2b' : '#d9e8e6'
	const onBg = isLight ? '#162525' : '#eefaf8'
	const border = isLight
		? mixHex(panel, text, 0.16)
		: mixHex(panel, '#ffffff', 0.11)
	const dot = isLight ? mixHex(border, text, 0.28) : mixHex(border, text, 0.22)
	const sbTrack = isLight ? mixHex(bg, panel, 0.7) : mixHex(bg, '#000000', 0.12)
	const sbThumb = isLight
		? mixHex(border, text, 0.25)
		: mixHex(panel, '#ffffff', 0.18)
	return {
		bg,
		panel,
		border,
		text,
		onBg,
		canvas: bg,
		dot,
		sbTrack,
		sbThumb,
		sbThumbHover: mixHex(sbThumb, text, 0.18),
	}
}

const THEME_VARS: Record<string, string> = {
	bg: '--c-bg',
	panel: '--c-panel',
	border: '--c-border',
	text: '--c-text',
	onBg: '--c-on-bg',
	canvas: '--c-canvas',
	dot: '--c-dot',
	sbTrack: '--c-sb-track',
	sbThumb: '--c-sb-thumb',
	sbThumbHover: '--c-sb-thumb-hover',
}

export function applySurfaceForTheme(theme: 'dark' | 'light') {
	if (typeof document === 'undefined') return
	const root = document.documentElement
	const stored = loadSurfacePalette(theme)
	if (!stored) {
		for (const name of Object.keys(THEME_VARS)) root.style.removeProperty(THEME_VARS[name])
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', theme === 'light' ? '#f3f0e8' : '#070b12')
		return
	}
	const colors = surfaceColors(theme, stored)
	const keys = SURFACE_CSS(theme)
	for (const [name, cssVar] of Object.entries(THEME_VARS)) {
		const hex = (colors as Record<string, string>)[name]
		const value = name.startsWith('sb') ? hex : triplet(hex)
		root.style.setProperty(cssVar, value)
		localStorage.setItem((keys as Record<string, string>)[name] || '', value)
	}
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', colors.bg)
}

export function applySurfacePalette(
	theme: 'dark' | 'light',
	palette: SurfacePalette,
): SurfacePalette {
	const bg = normalizeHex(palette.bg) || '#070b12'
	const panel = normalizeHex(palette.panel) || '#0c1522'
	if (typeof document !== 'undefined') {
		try {
			const keys = SURFACE_HEX(theme)
			localStorage.setItem(keys.bg, bg)
			localStorage.setItem(keys.panel, panel)
		} catch {}
		applySurfaceForTheme(theme)
	}
	return { bg, panel }
}

export function clearSurfacePalette(theme: 'dark' | 'light') {
	if (typeof document !== 'undefined') {
		const root = document.documentElement
		for (const cssVar of Object.values(THEME_VARS))
			root.style.removeProperty(cssVar)
	}
	try {
		const keys = SURFACE_HEX(theme)
		localStorage.removeItem(keys.bg)
		localStorage.removeItem(keys.panel)
		for (const key of Object.values(SURFACE_CSS(theme)))
			localStorage.removeItem(key)
	} catch {}
	if (typeof document !== 'undefined') applySurfaceForTheme(theme)
}
