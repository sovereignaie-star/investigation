// src/utils/apiKeyManager.ts

interface ApiKeyInfo {
  key: string;
  name: string;
  url: string;
  envVar: string;
  configured: boolean;
  maskedValue: string;
}

class ApiKeyManager {
  private keys: Record<string, string> = {};

  constructor() {
    this.loadFromEnv();
    this.loadFromStorage();
  }

  private loadFromEnv(): void {
    const envKeys = [
      'TELEGRAM_BOT_TOKEN', 'TWITTER_BEARER_TOKEN', 'GOOGLE_API_KEY',
      'GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX', 'GOOGLE_CLOUD_KEY',
      'GITHUB_TOKEN', 'DISCORD_BOT_TOKEN', 'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY', 'AZURE_API_KEY', 'SHODAN_API_KEY',
      'HUNTER_API_KEY', 'NUMVERIFY_API_KEY', 'TRUECALLER_API_KEY',
    ];

    for (const envKey of envKeys) {
      const value = process.env[envKey];
      if (value) {
        this.keys[envKey.toLowerCase().replace(/_/g, '_')] = value;
      }
    }
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('api_keys');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.keys = { ...this.keys, ...parsed };
      }
    } catch {}
  }

  saveToStorage(): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem('api_keys', JSON.stringify(this.keys));
  }

  setKey(name: string, value: string): void {
    this.keys[name] = value;
    this.saveToStorage();
  }

  getKey(name: string): string | undefined {
    return this.keys[name];
  }

  getAllKeys(): Record<string, string> {
    return { ...this.keys };
  }

  removeKey(name: string): void {
    delete this.keys[name];
    this.saveToStorage();
  }

  getStatus(): ApiKeyInfo[] {
    const requiredKeys: Array<{ key: string; name: string; url: string; envVar: string }> = [
      { key: 'telegram', name: 'Telegram Bot Token', url: 'https://t.me/BotFather', envVar: 'TELEGRAM_BOT_TOKEN' },
      { key: 'twitter', name: 'Twitter/X Bearer Token', url: 'https://developer.twitter.com/', envVar: 'TWITTER_BEARER_TOKEN' },
      { key: 'google', name: 'Google API Key', url: 'https://console.cloud.google.com/', envVar: 'GOOGLE_API_KEY' },
      { key: 'google_custom_search', name: 'Google CSE Key', url: 'https://developers.google.com/custom-search/', envVar: 'GOOGLE_CSE_KEY' },
      { key: 'google_cx', name: 'Google CSE CX', url: 'https://cse.google.com/', envVar: 'GOOGLE_CSE_CX' },
      { key: 'google_cloud', name: 'Google Cloud Key', url: 'https://console.cloud.google.com/', envVar: 'GOOGLE_CLOUD_KEY' },
      { key: 'github', name: 'GitHub Token', url: 'https://github.com/settings/tokens', envVar: 'GITHUB_TOKEN' },
      { key: 'discord', name: 'Discord Bot Token', url: 'https://discord.com/developers/', envVar: 'DISCORD_BOT_TOKEN' },
      { key: 'aws_access_key', name: 'AWS Access Key', url: 'https://console.aws.amazon.com/iam/', envVar: 'AWS_ACCESS_KEY_ID' },
      { key: 'aws_secret_key', name: 'AWS Secret Key', url: 'https://console.aws.amazon.com/iam/', envVar: 'AWS_SECRET_ACCESS_KEY' },
      { key: 'azure', name: 'Azure API Key', url: 'https://portal.azure.com/', envVar: 'AZURE_API_KEY' },
      { key: 'shodan', name: 'Shodan API Key', url: 'https://account.shodan.io/', envVar: 'SHODAN_API_KEY' },
      { key: 'hunter', name: 'Hunter.io API Key', url: 'https://hunter.io/api-keys', envVar: 'HUNTER_API_KEY' },
      { key: 'numverify', name: 'Numverify API Key', url: 'https://numverify.com/', envVar: 'NUMVERIFY_API_KEY' },
      { key: 'truecaller', name: 'Truecaller API Key', url: 'https://developer.truecaller.com/', envVar: 'TRUECALLER_API_KEY' },
    ];

    return requiredKeys.map(k => {
      const value = this.keys[k.key];
      return {
        key: k.key,
        name: k.name,
        url: k.url,
        envVar: k.envVar,
        configured: !!value,
        maskedValue: value ? `${value.substring(0, 6)}...${value.substring(value.length - 4)}` : '',
      };
    });
  }
}

export const apiKeyManager = new ApiKeyManager();
