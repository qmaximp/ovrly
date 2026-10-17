export type MediaConfig = {
	enabled: true
	storage: 'r2' | 'local'
	maxBytes: number
	imageMaxBytes: number
	videoMaxBytes: number
	soundMaxBytes: number
}

export type StoredMedia = {
	key: string
	url: string
	size: number
	contentType: string
}

export function isConfigured(): boolean
export function mediaConfig(): MediaConfig | null
export function putBuffer(
	buffer: Buffer,
	contentType: string,
	fileName?: string,
): Promise<StoredMedia>
export function putDataUrl(value: string): Promise<StoredMedia | null>
export function parseDataUrl(
	value: string,
): { buffer: Buffer; type: string } | null
export function resolveType(
	contentType: string,
	fileName?: string,
): { contentType: string; ext: string } | null
