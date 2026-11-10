import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as vscode from 'vscode';
import { ConfluencePage } from './types';
import { getConfig } from './utils';
import { getApiToken, redactSecrets } from './credentials';

/**
 * Confluence REST API client.
 * Uses the v1 REST API for broad compatibility with both Cloud and Server/DC.
 */
export class ConfluenceApi {
  private baseUrl: string;
  private username: string;
  private apiToken: string;

  constructor() {
    const config = getConfig();
    this.baseUrl = config.get<string>('baseUrl') || '';
    this.username = config.get<string>('username') || '';
    this.apiToken = getApiToken();
  }

  /**
   * Refresh credentials from settings (call after config changes).
   */
  refreshConfig(): void {
    const config = getConfig();
    this.baseUrl = config.get<string>('baseUrl') || '';
    this.username = config.get<string>('username') || '';
    this.apiToken = getApiToken();
  }

  /**
   * Check if the API is configured with required credentials.
   */
  isConfigured(): boolean {
    return !!(this.baseUrl && this.apiToken);
  }

  /**
   * Get a Confluence page by space key and title.
   */
  async getPageByTitle(spaceKey: string, title: string): Promise<ConfluencePage | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const encodedTitle = encodeURIComponent(title);
      const path = `/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&title=${encodedTitle}&expand=version`;
      const data = await this.request('GET', path);

      if (data && data.results && data.results.length > 0) {
        const page = data.results[0];
        return {
          id: page.id,
          title: page.title,
          status: page.status || 'current',
          version: {
            number: page.version?.number || 0,
            when: page.version?.when || '',
            by: page.version?.by
              ? { displayName: page.version.by.displayName || '' }
              : undefined,
            message: page.version?.message,
          },
          _links: {
            webui: page._links?.webui || '',
            base: page._links?.base || this.baseUrl,
            self: page._links?.self,
          },
        };
      }

      return null;
    } catch (err) {
      console.error(redactSecrets(`[VcMd2Conf] Failed to get page "${title}" in space "${spaceKey}": ${String(err)}`));
      return null;
    }
  }

  /**
   * Get a Confluence page by ID.
   */
  async getPageById(pageId: string): Promise<ConfluencePage | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const path = `/rest/api/content/${pageId}?expand=version`;
      const data = await this.request('GET', path);

      if (data && data.id) {
        return {
          id: data.id,
          title: data.title,
          status: data.status || 'current',
          version: {
            number: data.version?.number || 0,
            when: data.version?.when || '',
            by: data.version?.by
              ? { displayName: data.version.by.displayName || '' }
              : undefined,
            message: data.version?.message,
          },
          _links: {
            webui: data._links?.webui || '',
            base: data._links?.base || this.baseUrl,
            self: data._links?.self,
          },
        };
      }

      return null;
    } catch (err) {
      console.error(redactSecrets(`[VcMd2Conf] Failed to get page by ID "${pageId}": ${String(err)}`));
      return null;
    }
  }

  /**
   * Build the full web URL for a Confluence page.
   */
  getPageWebUrl(page: ConfluencePage): string {
    const base = page._links.base || this.baseUrl;
    return `${base}${page._links.webui}`;
  }

  /**
   * Test the connection to Confluence.
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Configurez l URL Confluence et le PAT. Pour Cloud, renseignez aussi votre email.',
      };
    }

    try {
      const data = await this.request('GET', '/rest/api/space?limit=1');
      if (data && data.results) {
        return {
          success: true,
          message: `Connected successfully. Found ${data.size || data.results.length} space(s).`,
        };
      }
      return { success: false, message: 'Unexpected API response.' };
    } catch (err: any) {
      return { success: false, message: redactSecrets(`Connection failed: ${err.message || err}`) };
    }
  }

  /**
   * Make an HTTP request to the Confluence REST API.
   */
  private request(method: string, apiPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl.replace(/\/+$/, '')}${apiPath}`);
      const auth = this.username
        ? `Basic ${Buffer.from(`${this.username}:${this.apiToken}`).toString('base64')}`
        : `Bearer ${this.apiToken}`;

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'VcMd2Conf-VSCode/0.1.0',
        },
        // Respect proxy settings if configured
        ...(this.getProxyAgent()),
      };

      const transport = url.protocol === 'https:' ? https : http;

      const req = transport.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(body);
            }
          } else if (res.statusCode === 401) {
            reject(new Error('HTTP 401 : authentification refusee. Verifiez le PAT et, pour Cloud, votre email.'));
          } else if (res.statusCode === 403) {
            reject(new Error('HTTP 403 : acces refuse. Verifiez les permissions Confluence de votre compte.'));
          } else if (res.statusCode === 404) {
            resolve(null);
          } else {
            reject(new Error(redactSecrets(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`)));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Network error: ${err.message}`));
      });

      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Request timed out after 15s'));
      });

      req.end();
    });
  }

  /**
   * Get proxy configuration from VS Code settings.
   */
  private getProxyAgent(): Record<string, any> {
    const httpConfig = vscode.workspace.getConfiguration('http');
    const proxy = httpConfig.get<string>('proxy');

    // If a proxy is set, we could add proxy agent support here
    // For now, we rely on system proxy settings via environment variables
    if (proxy) {
      // The http/https modules will use HTTP_PROXY/HTTPS_PROXY env vars
      // which are typically set by VS Code
    }

    return {};
  }
}
