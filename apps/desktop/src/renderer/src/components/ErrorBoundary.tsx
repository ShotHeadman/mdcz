import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackRender: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }): void {
    console.error("[renderer] uncaught render error", error, errorInfo.componentStack);
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallbackRender({
        error: this.state.error,
        reset: this.reset,
      });
    }

    return this.props.children;
  }
}
