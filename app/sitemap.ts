import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

// Дата последнего значимого изменения лендинга. Держим её статичной:
// меняющийся на каждый запрос lastmod Яндекс считает неинформативным.
const LAST_MODIFIED = new Date('2026-10-25T00:00:00+03:00')

// В индексе — только лендинг: панель, оверлей и кабинет доступны лишь по ссылке/сессии
export default function sitemap(): MetadataRoute.Sitemap {
	const base = siteUrl()
	return [
		{
			url: base,
			lastModified: LAST_MODIFIED,
			changeFrequency: 'weekly',
			priority: 1,
		},
		{
			url: `${base}/guide`,
			lastModified: LAST_MODIFIED,
			changeFrequency: 'monthly',
			priority: 0.7,
		},
	]
}
