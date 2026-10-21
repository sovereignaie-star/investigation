import * as React from "react";
import { Alert, AlertDescription, AlertTitle, Button } from "@ir/ui";
import { t } from "@ir/i18n";
import { buildErrorReport, describeThrown } from "./errorReport";

/**
 * P3-023: the app-wide error boundary. A render error or a failed lazy chunk shows an
 * understandable, COPYABLE report inside the shell instead of unmounting the tree
 * (the white screen). Keyed on the route: navigating away clears the error.
 */
interface Props {
  /** The current route; a change resets the boundary. */
  path: string;
  children: React.ReactNode;
}

interface State {
  failed: boolean;
  thrown: unknown;
  componentStack: string;
  at: Date;
  copy: "idle" | "copied" | "failed";
}

const INITIAL: State = { failed: false, thrown: null, componentStack: "", at: new Date(0), copy: "idle" };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = INITIAL;

  static getDerivedStateFromError(thrown: unknown): Partial<State> {
    return { failed: true, thrown, at: new Date(), copy: "idle" };
  }

  componentDidCatch(_thrown: unknown, info: React.ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  componentDidUpdate(prev: Props): void {
    if (prev.path !== this.props.path && this.state.failed) this.setState(INITIAL);
  }

  private report(): string {
    return buildErrorReport(this.state.thrown, { path: this.props.path, at: this.state.at, componentStack: this.state.componentStack });
  }

  private copy = (): void => {
    const text = this.report();
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) {
      this.setState({ copy: "failed" });
      return;
    }
    clipboard.writeText(text).then(
      () => this.setState({ copy: "copied" }),
      () => this.setState({ copy: "failed" }),
    );
  };

  private retry = (): void => this.setState(INITIAL);

  private reload = (): void => window.location.reload();

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    const { copy } = this.state;
    return (
      <Alert variant="destructive" data-app-error>
        <AlertTitle>{t("errors.boundary.title")}</AlertTitle>
        <AlertDescription>
          <p>{t("errors.boundary.hint")}</p>
          <p className="mt-2 font-medium" dir="ltr">
            {describeThrown(this.state.thrown)}
          </p>
          <p className="mt-3 text-xs">{t("errors.boundary.reportLabel")}</p>
          <pre
            data-error-report
            dir="ltr"
            className="mt-1 max-h-48 select-text overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-2 text-xs text-foreground"
          >
            {this.report()}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" data-error-copy onClick={this.copy}>
              {t("errors.boundary.copy")}
            </Button>
            <Button type="button" size="sm" data-error-retry onClick={this.retry}>
              {t("errors.boundary.retry")}
            </Button>
            <Button type="button" size="sm" variant="ghost" data-error-reload onClick={this.reload}>
              {t("errors.boundary.reload")}
            </Button>
            <span role="status" className="text-xs">
              {copy === "copied" ? t("errors.boundary.copied") : copy === "failed" ? t("errors.boundary.copyFailed") : ""}
            </span>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
}
