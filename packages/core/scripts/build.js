import { constants, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'
import dts from 'vite-plugin-dts'

async function generate() {
  const outDir = join(process.cwd(), './dist')
  const srcDir = join(process.cwd(), './src')

  await Promise.all([
    build({
      resolve: {
        alias: {
          '@src': srcDir,
        },
      },
      build: {
        lib: {
          entry: './src/index.ts',
          formats: ['es'],
          fileName: 'index',
        },
        target: 'esnext',
        outDir,
        emptyOutDir: false,
        minify: false,
      },
      plugins: [dts({ rollupTypes: true })],
    }),
    build({
      resolve: {
        alias: {
          '@src': srcDir,
        },
      },
      build: {
        lib: {
          entry: './src/index.ts',
          formats: ['es'],
          fileName: 'index.min',
        },
        target: 'esnext',
        outDir,
        minify: true,
      },
    }),
  ])
}

async function afterGenerate() {
  copyFileSync('../../LICENSE', 'dist/LICENSE', constants.COPYFILE_FICLONE)
  copyFileSync('README.md', 'dist/README.md', constants.COPYFILE_FICLONE)

  const packageJson = JSON.parse(readFileSync('package.json', { encoding: 'utf8' }))
  delete packageJson.devDependencies
  delete packageJson.publishConfig
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
  await generate()
  await afterGenerate()
}

main()
