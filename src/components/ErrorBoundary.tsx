"use client";
import { Component, type ReactNode } from "react";

// If a screen fails to draw, show what went wrong (and a retry) instead of leaving a dead page.
export default class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="card space-y-2"><p className="font-semibold text-red-800">{this.props.label ?? "This section"} couldn't be shown.</p><p className="text-sm text-slate-600 break-words">{this.state.error.message}</p><button className="btn" onClick={() => this.setState({ error: null })}>Try again</button></div>;
  }
}
