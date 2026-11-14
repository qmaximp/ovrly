import { clientIp, rateLimit } from '@/lib/api'
import { fetchTelegramPhoto, isBotConfigured } from '@/lib/telegramBot'

export const runtime = 'nodejs'

// Картинка из сообщения группы: file_id приходит в списке обновлений, а сам
// файл тянем через Bot API, чтобы токен бота не попадал в браузер.
export async function GET(
	req: Request,
	{ params }: { params: Promise<{ fileId: string }> },
) {
	if (!isBotConfigured()) return new Response('Not found', { status: 404 })
	if (!rateLimit(`tgp:${clientIp(req)}`, 120, 60_000))
		return new Response('Too many requests', { status: 429 })
	const { fileId } = await params
	// file_id — base64-подобная строка; всё остальное отсекаем.
	if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
		return new Response('Not found', { status: 404 })
	try {
		const file = await fetchTelegramPhoto(fileId)
		if (!file) return new Response('Not found', { status: 404 })
		return new Response(file.body as unknown as BodyInit, {
			headers: {
				'Content-Type': file.contentType,
				// file_id неизменен, поэтому кэшируем надолго.
				'Cache-Control': 'public, max-age=31536000, immutable',
			},
		})
	} catch {
		return new Response('Not found', { status: 404 })
	}
}
