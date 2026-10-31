import { createContext, useContext, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { JobSetup } from "./pages/JobSetup";
import { Ranked } from "./pages/Ranked";
import { Report } from "./pages/Report";
import { Room } from "./pages/Room";
import job from "../../../seed/job.json";

interface DemoControls {
  demo: boolean;
  setDemo: (value: boolean) => void;
}

const DemoContext = createContext<DemoControls>({ demo: false, setDemo: () => undefined });

export function useDemo(): DemoControls {
  return useContext(DemoContext);
}

export function App() {
  const [demo, setDemoState] = useState(() => localStorage.getItem("proofhire-demo") === "1");
  const controls = useMemo<DemoControls>(
    () => ({
      demo,
      setDemo(value: boolean) {
        localStorage.setItem("proofhire-demo", value ? "1" : "0");
        setDemoState(value);
      },
    }),
    [demo],
  );

  return (
    <DemoContext.Provider value={controls}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line bg-card/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
            <Link to="/" className="flex items-baseline gap-1.5">
              <span className="font-serif text-[1.7rem] italic leading-none text-accent">Proof</span>
              <span className="text-[1.7rem] font-semibold leading-none tracking-tight">Hire</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm font-semibold">
              <NavLink to="/" className={({ isActive }) => (isActive ? "text-accent" : "text-muted")}>
                Setup
              </NavLink>
              <NavLink to={`/jobs/${job.id}`} className={({ isActive }) => (isActive ? "text-accent" : "text-muted")}>
                Shortlist
              </NavLink>
            </nav>
            <button
              type="button"
              aria-pressed={demo}
              onClick={() => controls.setDemo(!demo)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${demo ? "border-warn bg-warn-bg text-warn" : "border-line bg-card text-ink"}`}
            >
              Demo mode {demo ? "on" : "off"}
            </button>
          </div>
        </header>
        {demo ? (
          <div className="bg-warn-bg px-5 py-2 text-center text-sm text-warn">
            Demo mode replays the recorded panel and does not call a model.
          </div>
        ) : null}
        <Routes>
          <Route path="/" element={<JobSetup />} />
          <Route path="/jobs/:id" element={<Ranked />} />
          <Route path="/candidates/:id" element={<Report />} />
          <Route path="/candidates/:id/room" element={<Room />} />
        </Routes>
      </div>
    </DemoContext.Provider>
  );
}
