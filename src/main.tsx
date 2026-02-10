import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

type RootErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message ?? "Unknown renderer error"
    };
  }

  componentDidCatch(error: Error): void {
    // Surface diagnostics in packaged environments where devtools is unavailable.
    console.error("Renderer crash:", error);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <main className="renderer-fallback">
        <h1>Renderer Error</h1>
        <p>{this.state.message}</p>
        <p>Please restart app. If this persists, check runtime.log in app data.</p>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
