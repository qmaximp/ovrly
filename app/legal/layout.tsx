import type { Metadata } from 'next'
import Link from 'next/link'
import LogoMark from '@/components/LogoMark'
import ThemeToggle from '@/components/ThemeToggle'
import CookieBanner from '@/components/CookieBanner'
import { LEGAL_DATE, LEGAL_DOCS, LEGAL_VERSION, OPERATOR } from '@/lib/legal'
import './legal.css'

export const metadata: Metadata = {
	title: {
		default: 'Правовая информация',
		template: '%s · Ovrly',
	},
	description:
		'Юридические документы Ovrly: политика обработки персональных данных, пользовательское соглашение, политика cookie и текст согласия.',
}

export default function LegalLayout({ children }: { children: React.ReactNode }) {
	return (
		<main className='legal-shell'>
			<header className='legal-top'>
				<Link href='/' className='legal-brand' aria-label='Ovrly — на главную'>
					<LogoMark size={30} />
					<span className='legal-brand-name'>Ovrly</span>
					<span className='legal-brand-sep'>/</span>
					<span className='legal-brand-section'>правовая информация</span>
				</Link>
				<div className='legal-top-actions'>
					<ThemeToggle />
					<Link href='/' className='legal-back'>
						На главную
					</Link>
				</div>
			</header>

			<div className='legal-wrap'>{children}</div>

			<footer className='legal-foot'>
				<div className='legal-foot-links'>
					{LEGAL_DOCS.map(doc => (
						<Link key={doc.href} href={doc.href}>
							{doc.short}
						</Link>
					))}
					<a href={OPERATOR.telegram} target='_blank' rel='noopener noreferrer'>
						Telegram
					</a>
					<a href={OPERATOR.repo} target='_blank' rel='noopener noreferrer'>
						GitHub
					</a>
				</div>
				<p className='legal-foot-meta'>
					© 2026 {OPERATOR.persons} · Ovrly · редакция документов от {LEGAL_DATE} (v
					{LEGAL_VERSION})
				</p>
				<p className='legal-foot-meta'>
					Оператор персональных данных: {OPERATOR.persons} ·{' '}
					<a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
				</p>
			</footer>

			<CookieBanner />
		</main>
	)
}
