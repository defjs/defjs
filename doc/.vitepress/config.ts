import { transformerTwoslash, type VitePressPluginTwoslashOptions } from '@shikijs/vitepress-twoslash'
import llmstxt from 'vitepress-plugin-llms'
import { tabsMarkdownPlugin } from 'vitepress-plugin-tabs'
import { defineConfig, type DefaultTheme } from 'vitepress'
import { JsxEmit } from 'typescript'
import { createApiSidebar } from './api-catalog.ts'

type TwoslashCache = NonNullable<VitePressPluginTwoslashOptions['typesCache']>
// Reuse identical translations within this build, without trusting results from older source or configuration.
const checkedExamples = new Map<string, ReturnType<TwoslashCache['read']>>()

type NavigationCopy = {
  docs: string
  startHere: string
  recipes: string
  why: string
  concepts: string
  reference: string
  integrations: string
  overview: string
  gettingStarted: string
  recipeGetDeclared404: string
  recipePostJson: string
  recipeCancelHttp: string
  recipeConsumeSse: string
  recipeWebsocketSession: string
  recipeTestWithHandle: string
  recipePublishHttpSdk: string
  recipeRefreshBearerOnce: string
  recipeEtagRevalidate: string
  recipeGraphqlHttpEnvelope: string
  designDecisions: string
  client: string
  commands: string
  struct: string
  errors: string
  http: string
  sse: string
  webSocket: string
  interceptors: string
  vue: string
  react: string
  opentelemetry: string
}

type LocaleCopy = {
  label: string
  lang: string
  description: string
  dir?: string
  navigation: NavigationCopy
  footer: {
    message: string
    copyright: string
  }
  editLink: string
  previous: string
  next: string
  searchPlaceholder?: string
}

type Navigation = {
  nav: DefaultTheme.NavItem[]
  sidebar: DefaultTheme.Sidebar
}

const editLinkPattern = 'https://github.com/defjs/defjs/edit/main/doc/:path'

const routes = {
  overview: '/',
  gettingStarted: '/guide/getting-started',
  designDecisions: '/guide/design-decisions',
  recipeGetDeclared404: '/recipes/get-declared-404',
  recipePostJson: '/recipes/post-json',
  recipeCancelHttp: '/recipes/cancel-http',
  recipeConsumeSse: '/recipes/consume-sse',
  recipeWebsocketSession: '/recipes/websocket-session',
  recipeTestWithHandle: '/recipes/test-with-handle',
  recipePublishHttpSdk: '/recipes/publish-http-sdk',
  recipeRefreshBearerOnce: '/recipes/refresh-bearer-once',
  recipeEtagRevalidate: '/recipes/etag-revalidate',
  recipeGraphqlHttpEnvelope: '/recipes/graphql-http-envelope',
  client: '/core/client',
  commands: '/core/commands',
  errors: '/core/errors',
  http: '/core/http',
  interceptors: '/core/interceptors',
  sse: '/core/sse',
  struct: '/core/struct',
  webSocket: '/core/web-socket',
  vue: '/plugins/vue',
  react: '/plugins/react',
  opentelemetry: '/plugins/opentelemetry-server',
  apiOverview: '/api/',
  apiClient: '/api/client',
  apiHttp: '/api/http',
  apiStruct: '/api/struct',
  apiErrors: '/api/errors',
  apiInterceptors: '/api/interceptors',
  apiSse: '/api/sse',
  apiWebSocket: '/api/web-socket',
} as const

type Route = (typeof routes)[keyof typeof routes]

const createNavigation = (prefix: string, copy: NavigationCopy): Navigation => {
  const link = (route: Route) => `${prefix}${route}`
  const sidebarLink = (text: string, route: Route): DefaultTheme.SidebarItem => ({
    text,
    link: link(route),
  })
  const sidebarGroup = (text: string, items: DefaultTheme.SidebarItem[]): DefaultTheme.SidebarItem => ({
    text,
    items,
    collapsed: false,
  })

  // Docs | Recipes | Reference. One sidebar group per workspace package.
  const docsActiveMatch = prefix ? `^${prefix}/(guide|core|plugins)/|^${prefix}/?$` : '^/(guide|core|plugins)/|^/$'

  const apiSidebar: DefaultTheme.SidebarItem[] = createApiSidebar(prefix, copy.overview)

  const docsSidebar = [
    sidebarGroup(copy.startHere, [sidebarLink(copy.overview, routes.overview), sidebarLink(copy.gettingStarted, routes.gettingStarted)]),
    sidebarGroup(copy.concepts, [
      sidebarLink(copy.client, routes.client),
      sidebarLink(copy.commands, routes.commands),
      sidebarLink(copy.struct, routes.struct),
      sidebarLink(copy.errors, routes.errors),
      sidebarLink(copy.http, routes.http),
      sidebarLink(copy.sse, routes.sse),
      sidebarLink(copy.webSocket, routes.webSocket),
      sidebarLink(copy.interceptors, routes.interceptors),
    ]),
    sidebarGroup(copy.why, [sidebarLink(copy.designDecisions, routes.designDecisions)]),
    sidebarGroup(copy.integrations, [
      sidebarLink(copy.vue, routes.vue),
      sidebarLink(copy.react, routes.react),
      sidebarLink(copy.opentelemetry, routes.opentelemetry),
    ]),
  ]

  const recipesSidebar = [
    sidebarGroup(copy.recipes, [
      sidebarLink(copy.recipeGetDeclared404, routes.recipeGetDeclared404),
      sidebarLink(copy.recipePostJson, routes.recipePostJson),
      sidebarLink(copy.recipeCancelHttp, routes.recipeCancelHttp),
      sidebarLink(copy.recipeConsumeSse, routes.recipeConsumeSse),
      sidebarLink(copy.recipeWebsocketSession, routes.recipeWebsocketSession),
      sidebarLink(copy.recipeTestWithHandle, routes.recipeTestWithHandle),
      sidebarLink(copy.recipePublishHttpSdk, routes.recipePublishHttpSdk),
      sidebarLink(copy.recipeRefreshBearerOnce, routes.recipeRefreshBearerOnce),
      sidebarLink(copy.recipeEtagRevalidate, routes.recipeEtagRevalidate),
      sidebarLink(copy.recipeGraphqlHttpEnvelope, routes.recipeGraphqlHttpEnvelope),
    ]),
  ]

  const base = prefix || ''

  return {
    nav: [
      {
        text: copy.docs,
        link: link(routes.gettingStarted),
        activeMatch: docsActiveMatch,
      },
      {
        text: copy.recipes,
        link: link(routes.recipeGetDeclared404),
        activeMatch: `${base}/recipes/`,
      },
      {
        text: copy.reference,
        link: link(routes.apiOverview),
        activeMatch: `${base}/api/`,
      },
    ],
    sidebar: {
      [`${base}/guide/`]: docsSidebar,
      [`${base}/core/`]: docsSidebar,
      [`${base}/plugins/`]: docsSidebar,
      [`${base}/`]: docsSidebar,
      [`${base}/recipes/`]: recipesSidebar,
      [`${base}/api/`]: apiSidebar,
    },
  }
}

const createLocale = (prefix: string, copy: LocaleCopy) => {
  const navigation = createNavigation(prefix, copy.navigation)

  return {
    label: copy.label,
    lang: copy.lang,
    description: copy.description,
    ...(copy.dir ? { dir: copy.dir } : {}),
    themeConfig: {
      nav: navigation.nav,
      sidebar: navigation.sidebar,
      footer: copy.footer,
      editLink: {
        pattern: editLinkPattern,
        text: copy.editLink,
      },
      docFooter: {
        prev: copy.previous,
        next: copy.next,
      },
      ...(copy.searchPlaceholder
        ? {
            search: {
              provider: 'local' as const,
              options: {
                translations: {
                  button: {
                    buttonText: copy.searchPlaceholder,
                    buttonAriaLabel: copy.searchPlaceholder,
                  },
                },
              },
            },
          }
        : {}),
    },
  }
}

const enNavigation: NavigationCopy = {
  docs: 'Docs',
  startHere: 'Start Here',
  recipes: 'Recipes',
  why: 'Why',
  concepts: 'Concepts',
  reference: 'Reference',
  integrations: 'Integrations',
  overview: 'Overview',
  gettingStarted: 'Getting Started',
  recipeGetDeclared404: 'GET with a declared 404',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: 'Cancel an HTTP call',
  recipeConsumeSse: 'Consume an SSE stream',
  recipeWebsocketSession: 'Open a WebSocket session',
  recipeTestWithHandle: 'Test with a local Fetch handle',
  recipePublishHttpSdk: 'Publish an HTTP SDK',
  recipeRefreshBearerOnce: 'Refresh Bearer once on 401',
  recipeEtagRevalidate: 'Revalidate with ETag',
  recipeGraphqlHttpEnvelope: 'Unwrap a GraphQL HTTP envelope',
  designDecisions: 'Design Decisions',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const zhHansNavigation: NavigationCopy = {
  docs: '文档',
  startHere: '从这里开始',
  recipes: '示例',
  why: '为什么这样设计',
  concepts: '概念',
  reference: 'API Reference',
  integrations: '集成',
  overview: '概览',
  gettingStarted: '快速开始',
  recipeGetDeclared404: '带声明 404 的 GET',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: '取消一次 HTTP',
  recipeConsumeSse: '消费一条 SSE',
  recipeWebsocketSession: '打开 WebSocket 会话',
  recipeTestWithHandle: '用本地 Fetch 测',
  recipePublishHttpSdk: '发布 HTTP SDK',
  recipeRefreshBearerOnce: '401 时刷新一次 Bearer',
  recipeEtagRevalidate: '用 ETag 再验证',
  recipeGraphqlHttpEnvelope: '拆 GraphQL HTTP 信封',
  designDecisions: '设计取舍',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const zhHantTwNavigation: NavigationCopy = {
  docs: '文件',
  startHere: '從這裡開始',
  recipes: '動手例子',
  why: '為什麼這樣設計',
  concepts: '概念',
  reference: '查閱',
  integrations: '整合',
  overview: '概覽',
  gettingStarted: '開始使用',
  recipeGetDeclared404: '宣告 404 的 GET',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: '取消一次 HTTP',
  recipeConsumeSse: '消費一條 SSE',
  recipeWebsocketSession: '打開 WebSocket session',
  recipeTestWithHandle: '用本地 Fetch 測試',
  recipePublishHttpSdk: '發布 HTTP SDK',
  recipeRefreshBearerOnce: '401 時刷新一次 Bearer',
  recipeEtagRevalidate: '用 ETag 再驗證',
  recipeGraphqlHttpEnvelope: '拆 GraphQL HTTP 信封',
  designDecisions: '設計取捨',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const zhHantHkNavigation: NavigationCopy = {
  docs: '文件',
  startHere: '由呢度開始',
  recipes: '手作例子',
  why: '點解咁設計',
  concepts: '概念',
  reference: '查資料',
  integrations: '整合',
  overview: '概覽',
  gettingStarted: '快速上手',
  recipeGetDeclared404: '帶 declared 404 嘅 GET',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: 'Cancel 一次 HTTP',
  recipeConsumeSse: 'Consume 一條 SSE',
  recipeWebsocketSession: '開一個 WebSocket session',
  recipeTestWithHandle: '用本地 Fetch handle 測',
  recipePublishHttpSdk: '發布 HTTP SDK',
  recipeRefreshBearerOnce: '401 時刷新一次 Bearer',
  recipeEtagRevalidate: '用 ETag 再驗證',
  recipeGraphqlHttpEnvelope: '拆 GraphQL HTTP 信封',
  designDecisions: '設計取捨',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const deNavigation: NavigationCopy = {
  docs: 'Docs',
  startHere: 'Hier starten',
  recipes: 'Rezepte',
  why: 'Warum',
  concepts: 'Konzepte',
  reference: 'Referenz',
  integrations: 'Integrationen',
  overview: 'Überblick',
  gettingStarted: 'Erste Schritte',
  recipeGetDeclared404: 'GET mit deklariertem 404',
  recipePostJson: 'JSON posten',
  recipeCancelHttp: 'HTTP-Aufruf abbrechen',
  recipeConsumeSse: 'SSE-Stream lesen',
  recipeWebsocketSession: 'WebSocket-Session öffnen',
  recipeTestWithHandle: 'Mit lokalem Fetch testen',
  recipePublishHttpSdk: 'HTTP-SDK veröffentlichen',
  recipeRefreshBearerOnce: 'Bearer einmal bei 401 erneuern',
  recipeEtagRevalidate: 'Mit ETag revalidieren',
  recipeGraphqlHttpEnvelope: 'GraphQL-HTTP-Envelope entpacken',
  designDecisions: 'Designentscheidungen',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const jaNavigation: NavigationCopy = {
  docs: 'ドキュメント',
  startHere: 'まずここから',
  recipes: 'レシピ',
  why: 'なぜこうなのか',
  concepts: '概念',
  reference: 'リファレンス',
  integrations: '連携',
  overview: '概要',
  gettingStarted: 'はじめよう',
  recipeGetDeclared404: '404 を宣言した GET',
  recipePostJson: 'JSON を POST する',
  recipeCancelHttp: 'HTTP をキャンセルする',
  recipeConsumeSse: 'SSE を読む',
  recipeWebsocketSession: 'WebSocket を開く',
  recipeTestWithHandle: 'ローカル Fetch で試す',
  recipePublishHttpSdk: 'HTTP SDK を公開する',
  recipeRefreshBearerOnce: '401 で Bearer を一度だけ更新',
  recipeEtagRevalidate: 'ETag で再検証する',
  recipeGraphqlHttpEnvelope: 'GraphQL HTTP 封筒をほどく',
  designDecisions: '設計の判断',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const koNavigation: NavigationCopy = {
  docs: '문서',
  startHere: '여기서 시작',
  recipes: '레시피',
  why: '왜 이렇게',
  concepts: '개념',
  reference: '참고',
  integrations: '연동',
  overview: '개요',
  gettingStarted: '시작하기',
  recipeGetDeclared404: '선언된 404가 있는 GET',
  recipePostJson: 'JSON POST',
  recipeCancelHttp: 'HTTP 취소하기',
  recipeConsumeSse: 'SSE 읽기',
  recipeWebsocketSession: 'WebSocket 열기',
  recipeTestWithHandle: '로컬 Fetch로 테스트',
  recipePublishHttpSdk: 'HTTP SDK 게시',
  recipeRefreshBearerOnce: '401에서 Bearer 한 번 갱신',
  recipeEtagRevalidate: 'ETag로 재검증',
  recipeGraphqlHttpEnvelope: 'GraphQL HTTP 봉투 풀기',
  designDecisions: '설계 선택',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const arNavigation: NavigationCopy = {
  docs: 'المستندات',
  startHere: 'ابدأ من هنا',
  recipes: 'وصفات',
  why: 'لماذا',
  concepts: 'مفاهيم',
  reference: 'مرجع',
  integrations: 'تكاملات',
  overview: 'نظرة عامة',
  gettingStarted: 'ابدأ الآن',
  recipeGetDeclared404: 'GET مع 404 معلن',
  recipePostJson: 'أرسل JSON',
  recipeCancelHttp: 'ألغِ طلب HTTP',
  recipeConsumeSse: 'اقرأ بث SSE',
  recipeWebsocketSession: 'افتح جلسة WebSocket',
  recipeTestWithHandle: 'اختبر بـ Fetch محلي',
  recipePublishHttpSdk: 'نشر SDK HTTP',
  recipeRefreshBearerOnce: 'تجديد Bearer مرة عند 401',
  recipeEtagRevalidate: 'إعادة التحقق بـ ETag',
  recipeGraphqlHttpEnvelope: 'فك غلاف GraphQL عبر HTTP',
  designDecisions: 'قرارات التصميم',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const esNavigation: NavigationCopy = {
  docs: 'Docs',
  startHere: 'Empieza aquí',
  recipes: 'Recetas',
  why: 'Por qué',
  concepts: 'Conceptos',
  reference: 'Referencia',
  integrations: 'Integraciones',
  overview: 'Resumen',
  gettingStarted: 'Primeros pasos',
  recipeGetDeclared404: 'GET con 404 declarado',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: 'Cancelar una llamada HTTP',
  recipeConsumeSse: 'Consumir un SSE',
  recipeWebsocketSession: 'Abrir un WebSocket',
  recipeTestWithHandle: 'Probar con Fetch local',
  recipePublishHttpSdk: 'Publicar un SDK HTTP',
  recipeRefreshBearerOnce: 'Refrescar Bearer una vez en 401',
  recipeEtagRevalidate: 'Revalidar con ETag',
  recipeGraphqlHttpEnvelope: 'Desenvolver un sobre GraphQL HTTP',
  designDecisions: 'Decisiones de diseño',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const ruNavigation: NavigationCopy = {
  docs: 'Документация',
  startHere: 'Начни здесь',
  recipes: 'Рецепты',
  why: 'Почему так',
  concepts: 'Концепции',
  reference: 'Справка',
  integrations: 'Интеграции',
  overview: 'Обзор',
  gettingStarted: 'Быстрый старт',
  recipeGetDeclared404: 'GET с объявленным 404',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: 'Отменить HTTP',
  recipeConsumeSse: 'Читать SSE',
  recipeWebsocketSession: 'Открыть WebSocket',
  recipeTestWithHandle: 'Тест с локальным Fetch',
  recipePublishHttpSdk: 'Опубликовать HTTP SDK',
  recipeRefreshBearerOnce: 'Обновить Bearer один раз при 401',
  recipeEtagRevalidate: 'Ревалидация с ETag',
  recipeGraphqlHttpEnvelope: 'Распаковать GraphQL HTTP-конверт',
  designDecisions: 'Решения по дизайну',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

const frNavigation: NavigationCopy = {
  docs: 'Docs',
  startHere: 'Commence ici',
  recipes: 'Recettes',
  why: 'Pourquoi',
  concepts: 'Concepts',
  reference: 'Référence',
  integrations: 'Intégrations',
  overview: "Vue d'ensemble",
  gettingStarted: 'Démarre vite',
  recipeGetDeclared404: 'GET avec un 404 déclaré',
  recipePostJson: 'POST JSON',
  recipeCancelHttp: 'Annuler un appel HTTP',
  recipeConsumeSse: 'Lire un flux SSE',
  recipeWebsocketSession: 'Ouvrir un WebSocket',
  recipeTestWithHandle: 'Tester avec un Fetch local',
  recipePublishHttpSdk: 'Publier un SDK HTTP',
  recipeRefreshBearerOnce: 'Rafraîchir le Bearer une fois sur 401',
  recipeEtagRevalidate: 'Revalider avec ETag',
  recipeGraphqlHttpEnvelope: 'Déballer une enveloppe GraphQL HTTP',
  designDecisions: 'Choix de conception',
  client: 'Client',
  commands: 'Commands',
  struct: 'Struct',
  errors: 'Errors',
  http: 'HTTP',
  sse: 'SSE',
  webSocket: 'WebSocket',
  interceptors: 'Interceptors',
  vue: 'Vue',
  react: 'React',
  opentelemetry: 'OpenTelemetry Server',
}

export default defineConfig({
  title: 'Defjs',
  description: 'Typed APIs across HTTP, SSE, and WebSocket',
  // Relocatable build: every page references assets and other pages relative to its own location,
  // so the same dist/ works from any domain or sub path without a rebuild — the host isn't decided
  // yet. Requires cleanUrls off: portable output needs links that end in `.html`, since there is no
  // server to rewrite pretty URLs. https://vitepress.dev/guide/deploy#relocatable-builds-relative-base
  base: './',

  markdown: {
    config(md) {
      md.use(tabsMarkdownPlugin)
    },
    codeTransformers: [
      transformerTwoslash({
        throws: true,
        typesCache: {
          read(code, lang) {
            return checkedExamples.get(`${lang}:${code}`) ?? null
          },
          write(code, result, lang) {
            checkedExamples.set(`${lang}:${code}`, result)
          },
        },
        twoslashOptions: {
          vfsRoot: process.cwd(),
          compilerOptions: {
            jsx: JsxEmit.ReactJSX,
          },
          handbookOptions: {
            noErrors: false,
            noErrorValidation: false,
          },
        },
      }),
    ],
    languages: ['js', 'jsx', 'json', 'ts', 'tsx', 'vue'],
  },

  vite: {
    plugins: [
      ...llmstxt({
        workDir: '.',
        injectLLMHint: false,
        ignoreFiles: [
          'ar/**',
          'de-DE/**',
          'es-ES/**',
          'fr-FR/**',
          'ja-JP/**',
          'ko-KR/**',
          'ru-RU/**',
          'zh-Hans/**',
          'zh-Hant-HK/**',
          'zh-Hant-TW/**',
        ],
      }),
    ],
    build: {
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/@vueuse/core/')) {
            return
          }

          defaultHandler(warning)
        },
      },
    },
  },

  locales: {
    root: createLocale('', {
      label: 'English',
      lang: 'en-US',
      description: 'Typed APIs across HTTP, SSE, and WebSocket',
      navigation: enNavigation,
      searchPlaceholder: 'Search recipes, HTTP, SSE, WebSocket…',
      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'Edit this page on GitHub',
      previous: 'Previous',
      next: 'Next',
    }),
    'zh-Hans': createLocale('/zh-Hans', {
      label: '简体中文',
      lang: 'zh-Hans',
      description: '跨 HTTP、SSE、WebSocket 的类型化 API',
      navigation: zhHansNavigation,
      searchPlaceholder: '搜食谱、HTTP、SSE、WebSocket…',
      footer: {
        message: '基于 MIT 许可证发布。',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: '在 GitHub 上编辑此页',
      previous: '上一页',
      next: '下一页',
    }),
    'zh-Hant-TW': createLocale('/zh-Hant-TW', {
      label: '繁體中文（台灣）',
      lang: 'zh-Hant-TW',
      description: '給 HTTP、SSE、WebSocket 用的型別化 API',
      navigation: zhHantTwNavigation,
      searchPlaceholder: '搜尋食譜、HTTP、SSE、WebSocket…',
      footer: {
        message: '以 MIT 授權條款發布。',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: '在 GitHub 上編輯此頁',
      previous: '上一頁',
      next: '下一頁',
    }),
    'zh-Hant-HK': createLocale('/zh-Hant-HK', {
      label: '繁體中文（香港）',
      lang: 'zh-Hant-HK',
      description: 'HTTP、SSE、WebSocket 嘅 typed API',
      navigation: zhHantHkNavigation,
      searchPlaceholder: '搜 recipes、HTTP、SSE、WebSocket…',
      footer: {
        message: '以 MIT 授權發布。',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: '喺 GitHub 編輯呢頁',
      previous: '上一頁',
      next: '下一頁',
    }),
    'de-DE': createLocale('/de-DE', {
      label: 'Deutsch',
      lang: 'de-DE',
      description: 'Typisierte APIs für HTTP, SSE und WebSocket',
      navigation: deNavigation,
      searchPlaceholder: 'Rezepte, HTTP, SSE, WebSocket suchen…',
      footer: {
        message: 'Veröffentlicht unter der MIT-Lizenz.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'Diese Seite auf GitHub bearbeiten',
      previous: 'Zurück',
      next: 'Weiter',
    }),
    'ja-JP': createLocale('/ja-JP', {
      label: '日本語',
      lang: 'ja-JP',
      description: 'HTTP / SSE / WebSocket 向けの型付き API',
      navigation: jaNavigation,
      searchPlaceholder: 'レシピ、HTTP、SSE、WebSocket を検索…',
      footer: {
        message: 'MIT ライセンスで公開しています。',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'GitHub でこのページを編集',
      previous: '前へ',
      next: '次へ',
    }),
    'ko-KR': createLocale('/ko-KR', {
      label: '한국어',
      lang: 'ko-KR',
      description: 'HTTP, SSE, WebSocket용 타입 API',
      navigation: koNavigation,
      searchPlaceholder: '레시피, HTTP, SSE, WebSocket 검색…',
      footer: {
        message: 'MIT 라이선스로 배포됩니다.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'GitHub에서 이 페이지 편집',
      previous: '이전',
      next: '다음',
    }),
    ar: createLocale('/ar', {
      label: 'العربية',
      lang: 'ar',
      dir: 'rtl',
      description: 'واجهات API مضبوطة الأنواع لـ HTTP وSSE وWebSocket',
      navigation: arNavigation,
      searchPlaceholder: 'ابحث في الوصفات وHTTP وSSE وWebSocket…',
      footer: {
        message: 'متاح بموجب ترخيص MIT.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'حرّر هذه الصفحة على GitHub',
      previous: 'السابق',
      next: 'التالي',
    }),
    'es-ES': createLocale('/es-ES', {
      label: 'Español',
      lang: 'es-ES',
      description: 'API tipadas para HTTP, SSE y WebSocket',
      navigation: esNavigation,
      searchPlaceholder: 'Busca recetas, HTTP, SSE, WebSocket…',
      footer: {
        message: 'Publicado bajo la licencia MIT.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'Editar esta página en GitHub',
      previous: 'Anterior',
      next: 'Siguiente',
    }),
    'ru-RU': createLocale('/ru-RU', {
      label: 'Русский',
      lang: 'ru-RU',
      description: 'Типизированные API для HTTP, SSE и WebSocket',
      navigation: ruNavigation,
      searchPlaceholder: 'Ищи рецепты, HTTP, SSE, WebSocket…',
      footer: {
        message: 'Под лицензией MIT.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'Редактировать на GitHub',
      previous: 'Назад',
      next: 'Дальше',
    }),
    'fr-FR': createLocale('/fr-FR', {
      label: 'Français',
      lang: 'fr-FR',
      description: 'API typées pour HTTP, SSE et WebSocket',
      navigation: frNavigation,
      searchPlaceholder: 'Cherche recettes, HTTP, SSE, WebSocket…',
      footer: {
        message: 'Publié sous licence MIT.',
        copyright: 'Copyright © 2026 MunMunMiao',
      },
      editLink: 'Modifier cette page sur GitHub',
      previous: 'Précédent',
      next: 'Suivant',
    }),
  },

  themeConfig: {
    logo: '/logo.jpg',
    siteTitle: 'Defjs',
    outline: false,
    aside: false,
    socialLinks: [{ icon: 'github', link: 'https://github.com/defjs/defjs' }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: 'Search recipes, HTTP, SSE, WebSocket…',
            buttonAriaLabel: 'Search recipes, HTTP, SSE, WebSocket…',
          },
        },
      },
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 MunMunMiao',
    },
  },
})
