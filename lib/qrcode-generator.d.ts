declare module 'qrcode-generator' {
	export type QRCode = {
		addData(data: string, mode?: string): void
		make(): void
		getModuleCount(): number
		isDark(row: number, col: number): boolean
	}
	export default function qrcode(
		typeNumber: number,
		errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H',
	): QRCode
}
