import type { MetadataRoute } from 'next'

// Закрытые от индексации разделы: панель/оверлей/кабинет работают только по ссылке
// с токеном комнаты и по сессии, в поиске им делать нечего
export default function robots(): MetadataRoute.Robots {
	const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
	return {
		rules: [
			{
				userAgent: '*',
				allow: '/',
				disallow: ['/panel', '/overlay', '/cabinet', '/api/'],
			},
		],
		sitemap: `${base}/sitemap.xml`,
		host: base,
	}
}
