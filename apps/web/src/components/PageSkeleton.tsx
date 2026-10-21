import { Skeleton } from "@ir/ui";
import { t } from "@ir/i18n";

/**
 * P3-023: the loading state while a route chunk downloads — a skeleton in the
 * page's rough shape plus the localized text for assistive technology.
 */
export function PageSkeleton(): React.ReactElement {
  return (
    <div role="status" aria-busy="true" className="space-y-4" data-page-skeleton>
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}
