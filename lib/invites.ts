// Инвайты и доступы. Данные живут в lib/storage: Postgres при наличии
// DATABASE_URL, иначе JSON в data/ (локальная разработка).
import * as storage from './storage'
import type { InviteEntry } from './storage'

export type InviteStatus = 'pending' | 'accepted'
export type ModeratorEntry = InviteEntry
export type InvitesData = Record<string, { moderators: Record<string, ModeratorEntry> }>

// владелец комнаты по токену ссылки
export async function findOwnerByToken(token: string): Promise<string | null> {
	return storage.findOwnerByToken(token)
}

export async function getInviteStatus(
	owner: string,
	login: string,
): Promise<ModeratorEntry | null> {
	return storage.getInvite(owner, login)
}

// приглашение в статусе pending: создаётся стримером по нику в кабинете.
// Уже принятый доступ не сбрасываем (повторное приглашение ничего не ломает)
export async function ensurePendingInvite(
	owner: string,
	login: string,
): Promise<ModeratorEntry> {
	const prev = await storage.getInvite(owner, login)
	const now = new Date().toISOString()
	const entry: ModeratorEntry =
		prev && prev.status === 'accepted'
			? { ...prev, visitedAt: now }
			: {
					status: 'pending',
					suspended: false,
					// доступ к OBS по умолчанию закрыт: включается вручную в кабинете
					obs: prev?.obs ?? 'none',
					invitedAt: prev?.invitedAt ?? now,
					visitedAt: now,
				}
	await storage.upsertInvite(owner, login, entry)
	return entry
}

export async function acceptInvite(owner: string, login: string): Promise<void> {
	const prev = await storage.getInvite(owner, login)
	// принять можно только живое приглашение: отстранённый модератор не должен
	// самовосстанавливаться повторным accept
	if (!prev || prev.status !== 'pending' || prev.suspended) return
	await storage.upsertInvite(owner, login, {
		...prev,
		status: 'accepted',
		acceptedAt: new Date().toISOString(),
	})
}

export async function setModeratorSuspended(
	owner: string,
	login: string,
	suspended: boolean,
): Promise<void> {
	const prev = await storage.getInvite(owner, login)
	if (!prev) return
	await storage.upsertInvite(owner, login, { ...prev, suspended })
}

export async function setModeratorObs(
	owner: string,
	login: string,
	obs: 'none' | 'control',
): Promise<void> {
	const prev = await storage.getInvite(owner, login)
	if (!prev) return
	await storage.upsertInvite(owner, login, { ...prev, obs })
}

export async function removeModerator(owner: string, login: string): Promise<void> {
	await storage.removeInvite(owner, login)
}

// все модераторы, приглашённые владельцем
export async function listModerators(
	owner: string,
): Promise<Array<ModeratorEntry & { login: string }>> {
	return storage.listModerators(owner)
}

// все доступы/приглашения, выданные аккаунту другими стримерами
export async function listInvitesFor(
	login: string,
): Promise<Array<{ owner: string; entry: ModeratorEntry }>> {
	return storage.listInvitesFor(login)
}
