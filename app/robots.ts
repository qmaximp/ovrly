import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site'

// Закрытые от индексации разделы: панель/оверлей/кабинет работают только по ссылке
// с токеном комнаты и по сессии, в поиске им делать нечего
export default function robots(): MetadataRoute.Robots {
	const base = siteUrl()
	return {
		rules: [
			{
				userAgent: '*',
				allow: '/',
				disallow: ['/panel', '/overlay', '/cabinet', '/admin', '/api/'],
			},
		],
		sitemap: `${base}/sitemap.xml`,
		// Host у Яндекса устарел: оставляем голое имя без схемы, чтобы не
		// выглядеть как невалидная директива в старых проверках
		host: base.replace(/^https?:\/\//, ''),
	}
}
