import OverlayClient from "@/components/OverlayClient";
import ErrorBoundary from "@/components/ErrorBoundary";
import { invalidLinkScreen, isValidRoomToken } from "@/lib/links";

export const dynamic = "force-dynamic";

export default function Overlay({ searchParams }: { searchParams?: { room?: string } }) {
	const room = searchParams?.room
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
