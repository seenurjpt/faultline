import { DashboardView } from "@/components/dashboard/dashboard-view";
import { UploadButton } from "@/components/upload/upload-button";
import { FaultGlyph, InlineError } from "@/components/ui/primitives";
import { isDbConfigured } from "@/lib/db";
import { buildOverview } from "@/lib/overview";
import { getAgents, listDatasets } from "@/lib/queries";

// SPEC §5.3: the overview is server-rendered from the URL search params, so a
// copied link reproduces the exact view.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage(props: PageProps<"/">) {
  const params = await props.searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  if (!isDbConfigured()) {
    return (
      <Shell>
        <InlineError message="The database isn't configured. Set DATABASE_URL and reload." />
      </Shell>
    );
  }

  let datasets;
  try {
    datasets = await listDatasets();
  } catch (error: unknown) {
    console.error("dashboard: listDatasets", error);
    return (
      <Shell>
        <InlineError message="Couldn't reach the database, so no datasets could be listed." />
      </Shell>
    );
  }

  if (datasets.length === 0) return <EmptyDashboard />;

  // SPEC §5.3: an unknown or missing dataset falls back to the newest one.
  const requested = first(params.dataset);
  const dataset =
    datasets.find((d) => d.id === requested) ?? datasets[0];
  const periodKey = first(params.period) ?? "all";

  const [overview, agents] = await Promise.all([
    buildOverview(dataset.id, periodKey),
    getAgents(dataset.id),
  ]);

  if (!overview) {
    return (
      <Shell>
        <InlineError message="That dataset couldn't be loaded." />
      </Shell>
    );
  }

  return (
    <DashboardView
      datasets={datasets}
      overview={overview}
      agents={agents}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-[var(--rule)] bg-[var(--paper)]">
        <div className="mx-auto flex min-h-14 max-w-[1360px] items-center px-4 sm:px-8">
          <span className="flex items-center gap-2 font-display text-[19px] leading-[26px] font-semibold">
            <FaultGlyph />
            Faultline
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-16 sm:px-8">
        {children}
      </main>
    </>
  );
}

// DESIGN §7: the empty dashboard points at the one thing worth doing.
function EmptyDashboard() {
  return (
    <>
      <header className="border-b border-[var(--rule)] bg-[var(--paper)]">
        <div className="mx-auto flex min-h-14 max-w-[1360px] items-center px-4 sm:px-8">
          <span className="flex items-center gap-2 font-display text-[19px] leading-[26px] font-semibold">
            <FaultGlyph />
            Faultline
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-16 sm:px-8">
        <h1 className="max-w-[48ch] font-display text-[29px] leading-[36px] font-semibold">
          No datasets yet. Upload a monitoring CSV to see availability and
          incidents.
        </h1>
        <div className="mt-6">
          <UploadButton />
        </div>
      </main>
    </>
  );
}
