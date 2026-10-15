import { defineConfig, type UserConfig } from 'tsdown'

const entries = {
  index: 'src/index.ts',
}

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
  packageJson['unpkg'] = './index.min.js'
  packageJson['jsdelivr'] = './index.min.js'
  delete packageJson['scripts']
  delete packageJson['devDependencies']
  delete packageJson['private']
  delete packageJson['publishConfig']

  await Bun.write(new URL('./dist/package.json', import.meta.url), `${JSON.stringify(packageJson, undefined, 2)}\n`)
}

export default defineConfig([
  {
    format: 'esm',
    outDir: 'dist',
    platform: 'neutral',
    target: false,
    tsconfig: 'tsconfig.build.json',
    clean: true,
    dts: true,
    entry: {
      index: entries.index,
    },
    inputOptions: {
      resolve: {
        mainFields: ['module', 'main'],
      },
    },
    copy: ['../../LICENSE', './README.md'],
    hooks: {
      async 'build:done'() {
        await writeDistPackageJson()
      },
    },
  } satisfies UserConfig,
  {
    format: 'esm',
    outDir: 'dist',
    platform: 'neutral',
    target: false,
    tsconfig: 'tsconfig.build.json',
    clean: false,
    dts: false,
    entry: {
      'index.min': entries.index,
    },
    minify: true,
    inputOptions: {
      resolve: {
        mainFields: ['module', 'main'],
      },
    },
  } satisfies UserConfig,
])
