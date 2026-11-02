import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

// Дата последнего значимого изменения лендинга. Держим её статичной:
// меняющийся на каждый запрос lastmod Яндекс считает неинформативным.
const LAST_MODIFIED = new Date('2026-10-25T00:00:00+03:00')
const LEGAL_MODIFIED = new Date('2026-11-02T00:00:00+03:00')

// В индексе — лендинг, инструкция и правовые документы: панель, оверлей и
// кабинет доступны лишь по ссылке/сессии
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
		{
			url: `${base}/legal`,
			lastModified: LEGAL_MODIFIED,
			changeFrequency: 'yearly',
			priority: 0.4,
		},
		{
			url: `${base}/legal/privacy`,
			lastModified: LEGAL_MODIFIED,
			changeFrequency: 'yearly',
			priority: 0.3,
		},
		{
			url: `${base}/legal/terms`,
			lastModified: LEGAL_MODIFIED,
			changeFrequency: 'yearly',
			priority: 0.3,
		},
		{
			url: `${base}/legal/cookies`,
			lastModified: LEGAL_MODIFIED,
			changeFrequency: 'yearly',
			priority: 0.3,
		},
		{
			url: `${base}/legal/consent`,
			lastModified: LEGAL_MODIFIED,
			changeFrequency: 'yearly',
			priority: 0.2,
		},
	]
}
