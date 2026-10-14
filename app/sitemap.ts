import type { MetadataRoute } from 'next'

// В индексе — только лендинг: панель, оверлей и кабинет доступны лишь по ссылке/сессии
export default function sitemap(): MetadataRoute.Sitemap {
	const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
	return [
		{
			url: `${base}/`,
			lastModified: new Date(),
			changeFrequency: 'weekly',
			priority: 1,
		},
	]
}
