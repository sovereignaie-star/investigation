/**
 * P3-013 (D-003): the settings screen — currently the key-management surface
 * (ApiKeySettings, UC-20). One nav item, one honest screen: no empty sections,
 * no placeholder pages.
 */
import { t } from "@ir/i18n";
import { ApiKeySettings } from "./settings/ApiKeySettings";

export function SettingsPage(): React.ReactElement {
  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm text-muted-foreground">{t("settings.kicker")}</p>
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
      </header>
      <ApiKeySettings />
    </div>
  );
}
