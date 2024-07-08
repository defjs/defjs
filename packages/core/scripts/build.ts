import dts from 'bun-plugin-dts'

await Bun.build({
	entrypoints: ['./src/index.ts'],
	outdir: './dist',
	format: 'esm',
	target: 'browser',
	splitting: false,
	minify: false,
	plugins: [
		dts({
			output: {
				noBanner: true,
			},
		}),
	],
})
