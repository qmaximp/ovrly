export default function LogoMark({ size = 36 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox='0 0 64 64' aria-hidden='true'>
			<rect
				className='logo-outline'
				x='20'
				y='4'
				width='34'
				height='34'
				rx='9'
				fill='none'
				strokeWidth='3'
			/>
			<rect
				className='logo-mid'
				x='12'
				y='14'
				width='34'
				height='34'
				rx='9'
			/>
			<rect
				className='logo-base'
				x='4'
				y='24'
				width='34'
				height='34'
				rx='9'
			/>
		</svg>
	)
}
