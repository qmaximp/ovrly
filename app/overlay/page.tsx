import type { Metadata } from "next";
import OverlayClient from "@/components/OverlayClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { invalidLinkScreen, isValidRoomToken } from "@/lib/links";

export const dynamic = "force-dynamic";

// Оверлей — служебная страница для OBS, не для индексации
export const metadata: Metadata = {
	title: { absolute: "Ovrly · оверлей" },
	robots: { index: false, follow: false },
};

export default async function Overlay({
	searchParams,
}: {
	searchParams?: Promise<{ room?: string }>
}) {
	const room = (await searchParams)?.room
	// оверлей тоже открывается только по ссылке с токеном комнаты: без него
	// работала бы «общая» комната-фантом, куда никто не пишет
	if (!room || !isValidRoomToken(room)) {
		return invalidLinkScreen()
	}
	return (
		<ErrorBoundary>
			<OverlayClient room={room} />
		</ErrorBoundary>
	)
}
