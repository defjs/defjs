import { constants, copyFileSync, writeFileSync } from 'fs'
import dts from 'bun-plugin-dts'

async function build() {
  await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist',
    format: 'esm',
    target: 'browser',
    minify: false,
    plugins: [
      dts({
        output: {
          noBanner: true,
        },
      }),
    ],
  })

  await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './dist',
    naming: '[dir]/[name].es.min.[ext]',
    format: 'esm',
    target: 'browser',
    minify: true,
  })
}

async function afterBuild() {
  copyFileSync('../../LICENSE', 'dist/LICENSE', constants.COPYFILE_FICLONE)
  copyFileSync('README.md', 'dist/README.md', constants.COPYFILE_FICLONE)

  const packageJson: Record<string, any> = await Bun.file('package.json').json()
  delete packageJson.devDependencies
  delete packageJson.scripts
  packageJson.module = 'index.js'
  packageJson.typings = 'index.d.ts'
  packageJson.exports = {
    './package.json': './package.json',
    '.': {
      types: './index.d.ts',
      default: './index.js',
    },
  }
  writeFileSync('dist/package.json', JSON.stringify(packageJson, undefined, 2))
}

async function main() {
  await build()
  await afterBuild()
}

main()
