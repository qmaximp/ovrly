// HTML-письма в стиле тёмной темы сайта.
//
// Вёрстка на таблицах и инлайн-стилях: Gmail и Outlook вырезают <style>,
// поэтому всё оформление живёт прямо в атрибутах.

const SITE = (process.env.SITE_URL || 'https://ovrly.ru').replace(/\/+$/, '')

const C = {
	page: '#070b12',
	card: '#0c1522',
	border: '#1c2b3b',
	accent: '#0f766e',
	mint: '#5eead4',
	chip: '#061019',
	title: '#eefaf8',
	text: '#a8bdba',
	muted: '#7d9391',
}

function esc(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

export type EmailContent = {
	preheader: string
	kicker: string
	heading: string
	intro: string
	code?: string
	note?: string
	reason: string
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
	const codeBlock = c.code
		? `
              <tr>
                <td style="padding:22px 34px 0">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:${C.chip};border:1px solid ${C.border};border-radius:14px;padding:18px 26px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:34px;line-height:1;letter-spacing:8px;font-weight:700;color:${C.mint}">${esc(c.code)}</td>
                    </tr>
                  </table>
                </td>
              </tr>`
		: ''

	const noteBlock = c.note
		? `
              <tr>
                <td style="padding:18px 34px 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${C.muted}">${esc(c.note)}</td>
              </tr>`
		: ''

	const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${esc(c.heading)}</title>
</head>
<body style="margin:0;padding:0">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:34px 14px">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:${C.card};border:1px solid ${C.border};border-radius:18px;overflow:hidden">
          <tr><td style="height:3px;background:${C.accent};font-size:0;line-height:0">&nbsp;</td></tr>
          <tr>
            <td style="padding:28px 34px 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:0.02em;color:${C.mint}">Ovrly</td>
          </tr>
          <tr>
            <td style="padding:18px 34px 0">
              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${C.mint}">${esc(c.kicker)}</div>
              <h1 style="margin:10px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:25px;line-height:1.25;font-weight:700;color:${C.title}">${esc(c.heading)}</h1>
              <p style="margin:12px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${C.text}">${esc(c.intro)}</p>
            </td>
          </tr>${codeBlock}${noteBlock}
          <tr>
            <td style="padding:24px 34px 0"><div style="height:1px;background:${C.border};font-size:0;line-height:0">&nbsp;</div></td>
          </tr>
          <tr>
            <td style="padding:18px 34px 30px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:${C.muted}">
            ${esc(c.reason)}<br>
            <a href="${SITE}" style="color:${C.mint};text-decoration:none">ovrly.ru</a>
            &nbsp;·&nbsp;
            <a href="${SITE}/legal/privacy" style="color:${C.muted};text-decoration:underline">Политика конфиденциальности</a>
            &nbsp;·&nbsp;
            <a href="${SITE}/legal/consent" style="color:${C.muted};text-decoration:underline">Согласие</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

	const lines = [c.heading, '', c.intro, '']
	if (c.code) lines.push(c.code, '')
	if (c.note) lines.push(c.note, '')
	lines.push(c.reason, SITE, `${SITE}/legal/privacy`)

	return { html, text: lines.join('\n') }
}
