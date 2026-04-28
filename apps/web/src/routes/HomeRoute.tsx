import { getSkeletonNavItems } from "../skeletonNav";

export const HomeRoute = () => (
  <main className="app-shell">
    <section className="hero-panel" aria-labelledby="webui-title">
      <p className="eyebrow">MDCz WebUI alpha</p>
      <h1 id="webui-title">Mounted media workspace</h1>
      <p className="hero-copy">
        Server and browser app skeletons are ready for the next persistence, API, and media-root slices.
      </p>
      <nav className="placeholder-grid" aria-label="Planned WebUI areas">
        {getSkeletonNavItems().map((item) => (
          <div className="placeholder-item" key={item.label}>
            <span>{item.label}</span>
            <small>{item.status}</small>
          </div>
        ))}
      </nav>
    </section>
  </main>
);
