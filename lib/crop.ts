import type { CSSProperties } from 'react'

export type Crop = { l: number; t: number; r: number; b: number }

// видимое «окно» должно остаться хоть сколько-то ненулевым
export const CROP_MAX = 0.98

export function cropActive(crop?: Crop | null): crop is Crop {
	return (
		!!crop &&
		(crop.l > 0.0005 || crop.t > 0.0005 || crop.r > 0.0005 || crop.b > 0.0005)
	)
}

// Внутренняя картинка/видео больше видимого бокса ровно на обрезанные доли,
// поэтому содержимое не растягивается, а края просто уходят за overflow: hidden.
export function cropInnerStyle(crop?: Crop | null): CSSProperties | undefined {
	if (!cropActive(crop)) return undefined
	const w = Math.max(0.02, 1 - crop.l - crop.r)
	const h = Math.max(0.02, 1 - crop.t - crop.b)
	return {
		position: 'absolute',
		left: `${(-crop.l / w) * 100}%`,
		top: `${(-crop.t / h) * 100}%`,
		width: `${100 / w}%`,
		height: `${100 / h}%`,
		maxWidth: 'none',
		maxHeight: 'none',
	}
}
