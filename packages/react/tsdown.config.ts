import { defineConfig, type UserConfig } from 'tsdown'

async function writeDistPackageJson(): Promise<void> {
  const packageJson = (await Bun.file(new URL('./package.json', import.meta.url)).json()) as Record<string, unknown>

  packageJson['main'] = './index.js'
  packageJson['module'] = './index.js'
  packageJson['types'] = './index.d.ts'
  packageJson['typings'] = './index.d.ts'
  packageJson['exports'] = {
    './package.json': './package.json',
    '.': {
      types: './index.d.ts',
      default: './index.js',
    },
  }
  delete packageJson['scripts']
  delete packageJson['devDependencies']
  delete packageJson['private']
  delete packageJson['publishConfig']

  await Bun.write(new URL('./dist/package.json', import.meta.url), `${JSON.stringify(packageJson, undefined, 2)}\n`)
}

export default defineConfig({
  format: 'esm',
  outDir: 'dist',
  platform: 'neutral',
  target: false,
  tsconfig: 'tsconfig.build.json',
  clean: true,
  dts: true,
  entry: {
    index: 'src/index.ts',
  },
  banner: {
    js: "'use client';",
  },
  inputOptions: {
    resolve: {
      mainFields: ['module', 'main'],
    },
  },
  deps: {
    neverBundle: ['react', 'react-dom', '@defjs/core'],
  },
  copy: ['../../LICENSE', './README.md'],
  hooks: {
    async 'build:done'() {
      await writeDistPackageJson()
    },
  },
} satisfies UserConfig)
