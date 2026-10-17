// Публичный адрес сайта для canonical, sitemap, robots и Open Graph.
// На хостинге лучше задать NEXT_PUBLIC_SITE_URL явно; для Railway/Render
// подхватываем их системные переменные, чтобы не отдавать localhost в индекс.
export function siteUrl(): string {
	const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
	if (explicit) return explicit.replace(/\/+$/, '')

	const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
	if (railway)
		return `https://${railway.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`

	const render = process.env.RENDER_EXTERNAL_URL?.trim()
	if (render) return render.replace(/\/+$/, '')

	return 'http://localhost:3000'
}
