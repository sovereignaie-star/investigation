import type { ApiKeyInfo } from '../types';

const STORAGE_KEY = 'ir_api_keys';

class ApiKeyManager {
  private keys: Record<string, string> = {};

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.keys = JSON.parse(stored);
      }
    } catch {
      // ignore
    }
  }

  saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keys));
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
      { key: 'google_cx', name: 'Google CSE CX', url: 'https://cse.google.com/', envVar: 'GOOGLE_CSE_CX' },
      { key: 'github', name: 'GitHub Token', url: 'https://github.com/settings/tokens', envVar: 'GITHUB_TOKEN' },
      { key: 'discord', name: 'Discord Bot Token', url: 'https://discord.com/developers/', envVar: 'DISCORD_BOT_TOKEN' },
      { key: 'shodan', name: 'Shodan API Key', url: 'https://account.shodan.io/', envVar: 'SHODAN_API_KEY' },
      { key: 'hunter', name: 'Hunter.io API Key', url: 'https://hunter.io/api-keys', envVar: 'HUNTER_API_KEY' },
      { key: 'numverify', name: 'Numverify API Key', url: 'https://numverify.com/', envVar: 'NUMVERIFY_API_KEY' },
      { key: 'hibp', name: 'HaveIBeenPwned API Key', url: 'https://haveibeenpwned.com/API/Key', envVar: 'HIBP_API_KEY' },
      { key: 'virustotal', name: 'VirusTotal API Key', url: 'https://www.virustotal.com/gui/my-apikey', envVar: 'VIRUSTOTAL_API_KEY' },
      { key: 'ipinfo', name: 'IPInfo Token', url: 'https://ipinfo.io/account/token', envVar: 'IPINFO_TOKEN' },
      { key: 'etherscan', name: 'Etherscan API Key', url: 'https://etherscan.io/myapikey', envVar: 'ETHERSCAN_API_KEY' },
      { key: 'aws_access', name: 'AWS Access Key ID', url: 'https://console.aws.amazon.com/iam/', envVar: 'AWS_ACCESS_KEY_ID' },
      { key: 'azure', name: 'Azure API Key', url: 'https://portal.azure.com/', envVar: 'AZURE_API_KEY' },
    ];

    return requiredKeys.map(k => {
      const value = this.keys[k.key];
      return {
        key: k.key,
        name: k.name,
        url: k.url,
        envVar: k.envVar,
        configured: !!value && value.length > 0,
        maskedValue: value
          ? `${value.substring(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`
          : '',
      };
    });
  }
}

export const apiKeyManager = new ApiKeyManager();
