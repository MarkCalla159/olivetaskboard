import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('Error de interfaz', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <main className="auth-shell">
        <section className="auth-card error-card" role="alert">
          <p className="eyebrow">Olive Taskboard</p>
          <h1>Algo salió mal</h1>
          <p className="subtitle">La pantalla no pudo cargarse correctamente. Puedes intentar abrirla de nuevo.</p>
          <button type="button" onClick={() => window.location.reload()}>Recargar aplicación</button>
        </section>
      </main>
    )
  }
}
