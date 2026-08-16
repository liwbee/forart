import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert, RefreshCw, Settings } from "lucide-react";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";

interface WorkspaceErrorBoundaryProps {
  children: ReactNode;
  title: string;
  description: string;
  retryLabel: string;
  settingsLabel: string;
  onOpenSettings: () => void;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
}

export class WorkspaceErrorBoundary extends Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
  state: WorkspaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace rendering failed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <Empty className="min-h-64 max-w-2xl border" role="alert">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CircleAlert className="text-destructive" aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>{this.props.title}</EmptyTitle>
            <EmptyDescription>{this.props.description}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => this.setState({ error: null })}>
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                {this.props.retryLabel}
              </Button>
              <Button variant="outline" onClick={this.props.onOpenSettings}>
                <Settings data-icon="inline-start" aria-hidden="true" />
                {this.props.settingsLabel}
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
}
