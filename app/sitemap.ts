import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

// В индексе — только лендинг: панель, оверлей и кабинет доступны лишь по ссылке/сессии
export default function sitemap(): MetadataRoute.Sitemap {
	const base = siteUrl()
	return [
		{
			url: `${base}/`,
			lastModified: new Date(),
			changeFrequency: 'weekly',
			priority: 1,
		},
	]
}
