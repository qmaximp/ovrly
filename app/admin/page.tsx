import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import AdminClient from '@/components/AdminClient'
import { isAdminLogin } from '@/lib/admin'
import { notRegisteredScreen } from '@/lib/links'
import { verifySession } from '@/lib/session'

export const dynamic = 'force-dynamic'

// Админка — служебная страница: поисковикам её показывать не нужно
export const metadata: Metadata = {
	title: { absolute: 'Ovrly · админка' },
	robots: { index: false, follow: false },
}

// Экран «нет доступа»: показываем тот же стиль, что и остальные служебные экраны
function noAccessScreen(login: string): React.ReactNode {
	return (
		<main className='min-h-screen bg-bg flex flex-col items-center justify-center px-4 text-center'>
			<div className='bg-panel border border-border rounded-2xl p-8 max-w-sm w-full'>
				<div className='text-5xl mb-4'>🔒</div>
				<h1 className='text-lg font-semibold text-[color:var(--c-on-bg)] mb-2'>
					Доступ только для администраторов
				</h1>
				<p className='text-sm text-gray-400 mb-6'>
					Аккаунт <span className='text-gray-200'>{login}</span> не входит в список
					администраторов панели.
				</p>
				<a
					href='/cabinet'
					className='inline-block px-6 py-3 rounded-lg bg-accent hover:bg-violet-700 text-white text-sm transition-colors'
				>
					В личный кабинет
				</a>
			</div>
		</main>
	)
}

export default async function AdminPage({
	searchParams,
}: {
	searchParams?: Promise<{ window?: string }>
}) {
	const session = verifySession((await cookies()).get('sc_session')?.value)
	if (!session) return notRegisteredScreen('/admin')
	if (!isAdminLogin(session.login)) return noAccessScreen(session.login)
	// ?window=1 — страница открыта отдельным окном (кнопкой в самой админке):
	// тогда саму кнопку прячем, чтобы не открывать окно из окна
	const standalone = (await searchParams)?.window === '1'
	return <AdminClient login={session.login} standalone={standalone} />
}
