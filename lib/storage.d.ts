export type LinkRecord = {
	login: string
	token: string
	updatedAt?: string
	userToken?: string
	userTokenExpires?: number
	refreshToken?: string
}

export type InviteEntry = {
	status: 'pending' | 'accepted'
	suspended: boolean
	invitedAt: string
	visitedAt?: string
	acceptedAt?: string
}

export type InviteRecord = InviteEntry & {
	owner: string
	moderator: string
}

export type LinkUpdate = Partial<Omit<LinkRecord, 'login'>> & {
	token?: string
}

export type ModeratorRecord = InviteEntry & {
	login: string
}

export type InviteForLogin = {
	owner: string
	entry: InviteEntry
}

export function hasDatabase(): boolean
export function getLinks(): Promise<LinkRecord[]>
export function saveLinks(
	data: Record<string, Omit<LinkRecord, 'login'>>,
): Promise<void>
export function getLink(login: string): Promise<LinkRecord | null>
export function upsertLink(
	login: string,
	partial: LinkUpdate,
): Promise<LinkRecord>
export function findOwnerByToken(token: string): Promise<string | null>
export function getOwner(): Promise<string | null>
export function setOwner(login: string): Promise<void>
export function getAllInvites(): Promise<InviteRecord[]>
export function getInvite(
	owner: string,
	moderator: string,
): Promise<InviteEntry | null>
export function upsertInvite(
	owner: string,
	moderator: string,
	entry: InviteEntry,
): Promise<void>
export function removeInvite(owner: string, moderator: string): Promise<void>
export function listModerators(owner: string): Promise<ModeratorRecord[]>
export function listInvitesFor(login: string): Promise<InviteForLogin[]>
