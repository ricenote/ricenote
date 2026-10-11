/**
 * 运行时配置的 JSON Schema。
 *
 * 环境变量在 loader 中被解析为结构化对象后，由本 Schema 做二次校验，
 * 保证"配置错误在启动瞬间暴露"，而不是在运行中以诡异方式失败。
 */

export const CONFIG_SCHEMA = {
  $id: 'https://ricenote.dev/schemas/config.schema.json',
  type: 'object',
  required: [
    'env',
    'logLevel',
    'http',
    'database',
    'security',
    'bootstrap',
    'paths',
    'site',
    'seedPlugins',
    'preview',
    'render',
    'pluginRegistry',
    'pluginInstall'
  ],
  additionalProperties: false,
  properties: {
    env: { enum: ['development', 'production', 'test'] },
    logLevel: { enum: ['debug', 'info', 'warn', 'error'] },
    http: {
      type: 'object',
      required: ['host', 'port', 'siteUrl'],
      additionalProperties: false,
      properties: {
        host: { type: 'string', minLength: 1 },
        // 0 表示"由系统分配空闲端口"，供测试装配真实 HTTP 服务使用
        port: { type: 'integer', minimum: 0, maximum: 65535 },
        siteUrl: { type: 'string', pattern: '^https?://' }
      }
    },
    database: {
      type: 'object',
      required: ['host', 'port', 'user', 'name', 'connectionLimit', 'readonly', 'dumpBinary', 'clientBinary'],
      additionalProperties: false,
      properties: {
        host: { type: 'string', minLength: 1 },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        user: { type: 'string', minLength: 1 },
        password: { type: 'string' },
        name: { type: 'string', minLength: 1 },
        url: { type: 'string' },
        connectionLimit: { type: 'integer', minimum: 1, maximum: 100 },
        readonly: { type: 'boolean' },
        dumpBinary: { type: 'string', minLength: 1 },
        clientBinary: { type: 'string', minLength: 1 }
      }
    },
    security: {
      type: 'object',
      required: ['sessionSecret', 'sessionTtlSeconds', 'csrfEnabled'],
      additionalProperties: false,
      properties: {
        sessionSecret: { type: 'string', minLength: 8 },
        sessionTtlSeconds: { type: 'integer', minimum: 300, maximum: 2592000 },
        csrfEnabled: { type: 'boolean' }
      }
    },
    bootstrap: {
      type: 'object',
      required: ['adminUsername', 'adminPassword', 'adminEmail'],
      additionalProperties: false,
      properties: {
        adminUsername: { type: 'string', minLength: 3, maxLength: 64 },
        adminPassword: { type: 'string', minLength: 8 },
        adminEmail: { type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' }
      }
    },
    paths: {
      type: 'object',
      required: [
        'rootDir',
        'storageDir',
        'uploadsDir',
        'cacheDir',
        'logsDir',
        'backupsDir',
        'pluginsDir',
        'pluginsInstallDir',
        'localPluginDirs',
        'themesDir'
      ],
      additionalProperties: false,
      properties: {
        rootDir: { type: 'string', minLength: 1 },
        storageDir: { type: 'string', minLength: 1 },
        uploadsDir: { type: 'string', minLength: 1 },
        cacheDir: { type: 'string', minLength: 1 },
        logsDir: { type: 'string', minLength: 1 },
        backupsDir: { type: 'string', minLength: 1 },
        pluginsDir: { type: 'string', minLength: 1 },
        pluginsInstallDir: { type: 'string', minLength: 1 },
        localPluginDirs: { type: 'array', items: { type: 'string', minLength: 1 } },
        themesDir: { type: 'string', minLength: 1 }
      }
    },
    site: {
      type: 'object',
      required: ['id', 'title', 'description', 'language', 'defaultTheme'],
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        description: { type: 'string' },
        language: { type: 'string', minLength: 2 },
        defaultTheme: { type: 'string', minLength: 1 }
      }
    },
    seedPlugins: {
      type: 'array',
      items: { type: 'string', minLength: 1 }
    },
    preview: {
      type: 'object',
      required: ['ttlSeconds'],
      additionalProperties: false,
      properties: {
        ttlSeconds: { type: 'integer', minimum: 30, maximum: 86400 }
      }
    },
    render: {
      type: 'object',
      required: ['cacheEnabled', 'cacheTtlSeconds'],
      additionalProperties: false,
      properties: {
        cacheEnabled: { type: 'boolean' },
        cacheTtlSeconds: { type: 'integer', minimum: 0, maximum: 86400 }
      }
    },
    pluginRegistry: {
      type: 'object',
      required: ['registry'],
      additionalProperties: false,
      properties: {
        registry: { type: 'string', pattern: '^https?://' },
        // 私有源令牌：只从环境变量读取，不进数据库、不进日志
        token: { type: 'string', minLength: 1 }
      }
    },
    pluginInstall: {
      type: 'object',
      required: ['allowScripts', 'commandTimeoutSeconds', 'watchLocalDirs'],
      additionalProperties: false,
      properties: {
        allowScripts: { type: 'boolean' },
        commandTimeoutSeconds: { type: 'integer', minimum: 30, maximum: 3600 },
        watchLocalDirs: { type: 'boolean' }
      }
    }
  }
} as const;
