/**
 * 运行时配置的 JSON Schema。
 *
 * 环境变量在 loader 中被解析为结构化对象后，由本 Schema 做二次校验，
 * 保证"配置错误在启动瞬间暴露"，而不是在运行中以诡异方式失败。
 */

export const CONFIG_SCHEMA = {
  $id: 'https://ricenote.dev/schemas/config.schema.json',
  type: 'object',
  required: ['env', 'logLevel', 'http', 'database', 'security', 'bootstrap', 'paths', 'site'],
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
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        siteUrl: { type: 'string', pattern: '^https?://' }
      }
    },
    database: {
      type: 'object',
      required: ['host', 'port', 'user', 'name', 'connectionLimit', 'readonly'],
      additionalProperties: false,
      properties: {
        host: { type: 'string', minLength: 1 },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        user: { type: 'string', minLength: 1 },
        password: { type: 'string' },
        name: { type: 'string', minLength: 1 },
        url: { type: 'string' },
        connectionLimit: { type: 'integer', minimum: 1, maximum: 100 },
        readonly: { type: 'boolean' }
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
      required: ['rootDir', 'storageDir', 'uploadsDir', 'cacheDir', 'logsDir', 'pluginsDir', 'themesDir'],
      additionalProperties: false,
      properties: {
        rootDir: { type: 'string', minLength: 1 },
        storageDir: { type: 'string', minLength: 1 },
        uploadsDir: { type: 'string', minLength: 1 },
        cacheDir: { type: 'string', minLength: 1 },
        logsDir: { type: 'string', minLength: 1 },
        pluginsDir: { type: 'string', minLength: 1 },
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
    }
  }
} as const;
