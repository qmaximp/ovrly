// Лимиты медиа для клиента. Держать в синхронизации с lib/mediaStore.js:
// сервер проверяет те же значения, но клиент должен отсекать файл до отправки,
// иначе пользователь ждёт загрузку и получает 413 в конце.
export const MB = 1024 * 1024

export const IMAGE_MAX_MB = 10
export const VIDEO_MAX_MB = 40
export const SOUND_MAX_MB = 5
export const ABSOLUTE_MAX_MB = 48

export class MediaFileError extends Error {}

// Лимит по MIME-типу файла: неизвестный тип ограничиваем абсолютным максимумом.
export function mediaLimitFor(mime: string): number {
	if (mime.startsWith('image/')) return IMAGE_MAX_MB * MB
	if (mime.startsWith('video/')) return VIDEO_MAX_MB * MB
	if (mime.startsWith('audio/')) return SOUND_MAX_MB * MB
	return ABSOLUTE_MAX_MB * MB
}

export function mediaLimitLabel(mime: string): string {
	if (mime.startsWith('image/')) return `${IMAGE_MAX_MB} МБ`
	if (mime.startsWith('video/')) return `${VIDEO_MAX_MB} МБ`
	if (mime.startsWith('audio/')) return `${SOUND_MAX_MB} МБ`
	return `${ABSOLUTE_MAX_MB} МБ`
}

// Проверка до отправки. Бросает MediaFileError с текстом для пользователя.
export function checkMediaFile(file: File): void {
	const limit = mediaLimitFor(file.type || '')
	if (file.size > limit) {
		throw new MediaFileError(
			`Файл «${file.name}» весит ${(file.size / MB).toFixed(1)} МБ, а можно до ${mediaLimitLabel(file.type || '')}. Сожмите его или добавьте ссылкой.`,
		)
	}
}
