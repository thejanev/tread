import { useEffect, useRef, useState } from "react";
import type { TireStats } from "@/components/tire-scene";

const IDLE: TireStats = { meters: 0, paused: false, steered: false };

export function TireStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<TireStats>(IDLE);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cleanup = () => {};
    let cancel = false;
    void import("@/components/tire-scene").then((mod) => {
      if (cancel || !hostRef.current) return;
      cleanup = mod.mountTireScene(hostRef.current, setStats);
    });
    return () => {
      cancel = true;
      cleanup();
    };
  }, []);

  const meters = Math.max(0, Math.round(stats.meters));

  return (
    <>
      <div
        ref={hostRef}
        className="absolute inset-0 cursor-grab touch-none"
        role="application"
        aria-label="A car tire leaving tracks. Drag to steer. Tap to pause."
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6 sm:p-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-serif text-4xl leading-none tracking-tight text-ink sm:text-5xl">
              Tread
            </p>
            <p className="mt-2 max-w-xs text-sm text-pretty text-muted">
              A real tire on asphalt. The tread stays where it rolled.
            </p>
          </div>
          <p className="pt-1 text-right font-sans text-sm tabular-nums tracking-wide text-ink">
            <span className="block text-xs tracking-widest text-muted uppercase">Track</span>
            {meters} m
          </p>
        </div>
        <p className="safe-bottom text-center text-xs tracking-widest text-muted uppercase">
          {stats.paused ? "Held · tap to roll" : "Drag to steer · tap to pause"}
        </p>
      </div>
    </>
  );
}
