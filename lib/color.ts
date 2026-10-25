// Цвет фона с отдельной прозрачностью. Цвета из наших пикеров — hex, но
// поддерживаем и rgb(), и произвольный CSS-цвет через color-mix.
export function colorWithOpacity(color?: string | null, opacity = 1): string {
	if (!color || color === 'transparent') return 'transparent'
	const a = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1))
	if (a >= 1) return color
	const hex = color.trim()
	const m6 = /^#([0-9a-f]{6})$/i.exec(hex)
	const m3 = /^#([0-9a-f]{3})$/i.exec(hex)
	const rgb = m6
		? [
				parseInt(m6[1].slice(0, 2), 16),
				parseInt(m6[1].slice(2, 4), 16),
				parseInt(m6[1].slice(4, 6), 16),
			]
		: m3
			? [
					parseInt(m3[1][0] + m3[1][0], 16),
					parseInt(m3[1][1] + m3[1][1], 16),
					parseInt(m3[1][2] + m3[1][2], 16),
				]
			: null
	if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`
	if (/^rgba?\(/i.test(hex)) {
		const body = hex.slice(hex.indexOf('(') + 1, -1)
		const parts = body.split(',').map(s => s.trim())
		if (parts.length >= 3) return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`
	}
	return `color-mix(in srgb, ${color} ${a * 100}%, transparent)`
}
