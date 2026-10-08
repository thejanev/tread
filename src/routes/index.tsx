import { createFileRoute } from "@tanstack/react-router";
import { TireStage } from "@/components/tire-stage";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="relative h-dvh overflow-hidden bg-studio text-ink">
      <TireStage />
    </main>
  );
}
