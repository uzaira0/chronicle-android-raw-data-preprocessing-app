import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Chronicle: unhandled render error", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            gap: "1rem",
            fontFamily: "system-ui, sans-serif",
            background: "#111318",
            color: "#e5e7eb",
          }}
        >
          <h1 style={{ color: "#ef4444", fontSize: "1.5rem", margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ margin: 0, opacity: 0.7 }}>
            The app encountered an unexpected error. Your files were not modified.
          </p>
          {this.state.error?.message ? (
            <pre
              style={{
                maxWidth: "40rem",
                overflow: "auto",
                padding: "0.75rem 1rem",
                background: "#1e2027",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
                opacity: 0.6,
                margin: 0,
              }}
            >
              {this.state.error.message}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "0.375rem",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
