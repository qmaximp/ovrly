const postgres = require('postgres')
const sql = postgres(process.env.DATABASE_URL)
;(async () => {
	const rows = await sql`select key, state from rooms`
	for (const r of rows) {
		const els = (r.state.elements || []).filter(e => e.type === 'telegram')
		for (const e of els) console.log(r.key, e.id, e.telegramChannel, e.width + 'x' + e.height)
	}
	process.exit(0)
})()
